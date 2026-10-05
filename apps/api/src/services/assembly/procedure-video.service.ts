import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { FileStorageAlreadyExistsError } from '../file-storage/file-storage-errors.js';
import type { ProcedureMaterialVideo } from './procedure-material-gmail-packet-resolver.js';
import { AssemblyTemplateAccessService } from './assembly-template-access.service.js';

export const procedureVideoLinksInclude = {
  orderBy: [{ pageIndex: 'asc' as const }, { sortOrder: 'asc' as const }],
  include: { video: true }
};
export type ProcedureVideoSummary = { id: string; title: string; durationSeconds: number | null; status: string };
export function videosForPage(links: Array<{ pageIndex: number; video: ProcedureVideoSummary & { discardedAt?: Date | null } }> | undefined, pageIndex: number): ProcedureVideoSummary[] {
  return (links ?? []).filter((link) => link.pageIndex === pageIndex && link.video.status === 'READY' && !link.video.discardedAt)
    .map(({ video }) => ({ id: video.id, title: video.title, durationSeconds: video.durationSeconds, status: video.status }));
}

export class ProcedureVideoService {
  constructor(
    private readonly db = defaultPrisma,
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
    private readonly access = new AssemblyTemplateAccessService(),
  ) {}

  async ingest(video: ProcedureMaterialVideo, common: { gmailMessageId: string; fromEmail: string | null; subjectHint: string | null; receivedAt: Date }): Promise<boolean> {
    const sourceStorageKey = `procedure-videos/incoming/${video.sha256}/original`;
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceStorageKey}))`;
        if (await tx.procedureVideo.findUnique({ where: { gmailDedupeKey: video.gmailDedupeKey } })) return false;
        try { await this.store.write({ key: sourceStorageKey, data: video.buffer, mode: 'create', integrity: true }); }
        catch (error) {
          if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
          if (!(await this.store.read(sourceStorageKey, { verifyIntegrity: true })).equals(video.buffer)) throw new Error('Procedure video identity conflict');
        }
        await tx.procedureVideo.create({ data: { ...common, status: 'PENDING', title: common.subjectHint || video.filename, gmailDedupeKey: video.gmailDedupeKey, sourceStorageKey, sourceFileName: video.filename, sourceContentType: video.contentType, sourceByteSize: video.buffer.length } });
        return true;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      if (!await this.db.procedureVideo.findUnique({ where: { gmailDedupeKey: video.gmailDedupeKey } })) throw error;
      return false;
    }
  }

  async list(params: { state: 'active' | 'discarded' | 'all'; q?: string; limit: number }) {
    const rows = await this.db.procedureVideo.findMany({
      where: { ...(params.state === 'active' ? { discardedAt: null } : params.state === 'discarded' ? { discardedAt: { not: null } } : {}), ...(params.q ? { OR: [{ title: { contains: params.q, mode: 'insensitive' as const } }, { subjectHint: { contains: params.q, mode: 'insensitive' as const } }] } : {}) },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: params.limit, include: { _count: { select: { links: true } } }
    });
    return rows.map((row) => ({ id: row.id, title: row.title, status: row.status, durationSeconds: row.durationSeconds, hasPoster: Boolean(row.posterStorageKey), linkCount: row._count.links, errorCode: row.errorCode, errorMessage: row.errorMessage, discardedAt: row.discardedAt?.toISOString() ?? null }));
  }

  async readFile(id: string, poster = false) {
    const video = await this.db.procedureVideo.findUnique({ where: { id } });
    const key = poster ? video?.posterStorageKey : video?.storageKey;
    if (video?.status !== 'READY' || !key) throw new ApiError(404, '動画がありません');
    return this.store.read(key, { verifyIntegrity: true });
  }

  async retry(id: string) {
    const changed = await this.db.procedureVideo.updateMany({ where: { id, status: 'FAILED', sourceStorageKey: { not: null } }, data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null } });
    if (!changed.count) throw new ApiError(409, '原本のある失敗動画だけ再試行できます');
  }

  async setDiscarded(id: string, discarded: boolean) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      if (!await tx.procedureVideo.findUnique({ where: { id } })) throw new ApiError(404, '動画がありません');
      if (discarded && await tx.procedureVideoLink.count({ where: { videoId: id } })) throw new ApiError(409, '紐づいている動画は捨てられません');
      await tx.procedureVideo.update({ where: { id }, data: { discardedAt: discarded ? new Date() : null } });
    });
  }

  async listPage(documentId: string, pageIndex: number) {
    const links = await this.db.procedureVideoLink.findMany({ where: { assemblyProcedureDocumentId: documentId, pageIndex }, orderBy: { sortOrder: 'asc' }, include: { video: true } });
    return links.map(({ video }) => ({ id: video.id, title: video.title, durationSeconds: video.durationSeconds, status: video.status }));
  }

  async replacePage(params: { documentId: string; pageIndex: number; videoIds: string[]; accessPassword?: string }) {
    await this.access.requireAccessPassword(params.accessPassword);
    await this.db.$transaction(async (tx) => {
      const [document] = await tx.$queryRaw<Array<{ status: string; isActive: boolean; isRevisionHead: boolean | null }>>`
        SELECT d."status", d."isActive", r."isRevisionHead" FROM "AssemblyProcedureDocument" d
        LEFT JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
        WHERE d."id" = ${params.documentId} FOR UPDATE OF d`;
      if (!document) throw new ApiError(404, '手順書が見つかりません');
      if (document.status !== 'DRAFT' || !document.isActive || !document.isRevisionHead) throw new ApiError(409, '最新版の改版下書きだけ編集できます');
      if (!await tx.assemblyProcedureDocumentPage.findUnique({ where: { documentId_pageIndex: { documentId: params.documentId, pageIndex: params.pageIndex } } })) throw new ApiError(400, '指定ページが存在しません');
      const ids = [...new Set(params.videoIds)];
      if (ids.length !== params.videoIds.length) throw new ApiError(400, '動画が重複しています');
      // Stable lock order serializes with discard without locking unrelated videos.
      for (const id of [...ids].sort()) {
        // eslint-disable-next-line no-await-in-loop
        await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      }
      if (await tx.procedureVideo.count({ where: { id: { in: ids }, discardedAt: null } }) !== ids.length) throw new ApiError(409, '動画がないか、捨てられています');
      await tx.procedureVideoLink.deleteMany({ where: { assemblyProcedureDocumentId: params.documentId, pageIndex: params.pageIndex } });
      if (ids.length) await tx.procedureVideoLink.createMany({ data: ids.map((videoId, sortOrder) => ({ videoId, sortOrder, assemblyProcedureDocumentId: params.documentId, pageIndex: params.pageIndex })) });
    });
    return this.listPage(params.documentId, params.pageIndex);
  }
}
