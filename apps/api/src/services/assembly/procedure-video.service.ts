import { AssemblyProcedureDocumentEditLeaseService, type AssemblyProcedureEditActor } from './assembly-procedure-document-edit-lease.service.js';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { ApiError } from '../../lib/errors.js';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { FileStorageAlreadyExistsError } from '../file-storage/file-storage-errors.js';
import type { ProcedureMaterialVideo } from './procedure-material-gmail-packet-resolver.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
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
      return await runAssemblyTransaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceStorageKey}))`;
        if (await tx.procedureVideo.findUnique({ where: { gmailDedupeKey: video.gmailDedupeKey } })) return false;
        try { await this.store.write({ key: sourceStorageKey, data: video.buffer, mode: 'create', integrity: true }); }
        catch (error) {
          if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
          if (!(await this.store.read(sourceStorageKey, { verifyIntegrity: true })).equals(video.buffer)) throw new Error('Procedure video identity conflict');
        }
        await tx.procedureVideo.create({ data: { ...common, origin: 'GMAIL', status: 'PENDING', title: common.subjectHint || video.filename, gmailDedupeKey: video.gmailDedupeKey, sourceStorageKey, sourceFileName: video.filename, sourceContentType: video.contentType, sourceByteSize: video.buffer.length } });
        return true;
      }, this.db);
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
    return rows.map((row) => ({ id: row.id, title: row.title, origin: row.origin ?? 'GMAIL', status: row.status, durationSeconds: row.durationSeconds, hasPoster: Boolean(row.posterStorageKey), linkCount: row._count.links, errorCode: row.errorCode, errorMessage: row.errorMessage, discardedAt: row.discardedAt?.toISOString() ?? null }));
  }

  async requestConcat(sourceVideoIds: string[], title?: string) {
    if (sourceVideoIds.length < 2 || sourceVideoIds.length > 5) throw new ApiError(400, '動画は2〜5本選んでください');
    return runAssemblyTransaction(async (tx) => {
      for (const id of [...new Set(sourceVideoIds)].sort()) {
        // eslint-disable-next-line no-await-in-loop
        await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      }
      const sources = await tx.procedureVideo.findMany({ where: { id: { in: sourceVideoIds } } });
      const ordered = sourceVideoIds.map((id) => sources.find((source) => source.id === id));
      if (ordered.some((source) => !source || source.status !== 'READY' || source.discardedAt)) throw new ApiError(409, '完了した動画だけ接続できます');
      const receivedAt = new Date();
      return tx.procedureVideo.create({ data: {
        status: 'PENDING', origin: 'CONCAT', title: title?.trim() || `${ordered[0]!.title} ほか ${sourceVideoIds.length - 1} 本`,
        gmailDedupeKey: `concat:${randomUUID()}`, gmailMessageId: null, receivedAt,
        sourceFileName: 'concat.mp4', sourceContentType: 'video/mp4', sourceByteSize: 0,
        concatRequest: { sourceVideoIds, requestedAt: receivedAt.toISOString() },
      } });
    }, this.db);
  }

  async readFile(id: string, poster = false) {
    const video = await this.db.procedureVideo.findUnique({ where: { id } });
    const key = poster ? video?.posterStorageKey : video?.storageKey;
    if (video?.status !== 'READY' || !key) throw new ApiError(404, '動画がありません');
    return this.store.read(key, { verifyIntegrity: true });
  }

  async retry(id: string) {
    const changed = await this.db.procedureVideo.updateMany({ where: { id, status: 'FAILED', OR: [{ sourceStorageKey: { not: null } }, { concatRequest: { not: Prisma.DbNull } }] }, data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null } });
    if (!changed.count) throw new ApiError(409, '原本のある失敗動画だけ再試行できます');
  }

  async requestTrim(id: string, startSeconds: number, endSeconds: number) {
    await runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      const video = await tx.procedureVideo.findUnique({ where: { id } });
      if (!video) throw new ApiError(404, '動画がありません');
      if (video.status !== 'READY') throw new ApiError(409, '完了した動画だけトリミングできます');
      if (video.durationSeconds == null || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds > video.durationSeconds || endSeconds < startSeconds + 0.5) {
        throw new ApiError(400, '開始・終了は動画の範囲内で、長さは0.5秒以上にしてください');
      }
      if (await tx.procedureVideoLink.count({ where: { videoId: id } })) throw new ApiError(409, '紐づけを外してからトリミングしてください');
      await tx.procedureVideo.update({ where: { id }, data: { trimRequest: { startSeconds, endSeconds, requestedAt: new Date().toISOString() }, status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null } });
    }, this.db);
  }

  async listComments(id: string) {
    if (!await this.db.procedureVideo.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, '動画がありません');
    return this.db.procedureVideoComment.findMany({ where: { videoId: id }, orderBy: { sortOrder: 'asc' } });
  }

  async replaceComments(id: string, comments: Array<{ atSeconds: number; text: string }>) {
    return runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      const video = await tx.procedureVideo.findUnique({ where: { id } });
      if (!video) throw new ApiError(404, '動画がありません');
      if (video.status !== 'READY') throw new ApiError(409, '完了した動画だけコメントを編集できます');
      const normalized = comments.map((comment) => ({ ...comment, text: comment.text.trim() })).sort((a, b) => a.atSeconds - b.atSeconds);
      if (normalized.length > 5 || normalized.some((comment) => !Number.isFinite(comment.atSeconds) || comment.atSeconds < 0 || video.durationSeconds == null || comment.atSeconds > video.durationSeconds || comment.text.length < 1 || comment.text.length > 80)) {
        throw new ApiError(400, 'コメントは5件まで、動画の範囲内の時刻と1〜80文字で入力してください');
      }
      await tx.procedureVideoComment.deleteMany({ where: { videoId: id } });
      if (normalized.length) await tx.procedureVideoComment.createMany({ data: normalized.map((comment, sortOrder) => ({ videoId: id, ...comment, sortOrder })) });
      return tx.procedureVideoComment.findMany({ where: { videoId: id }, orderBy: { sortOrder: 'asc' } });
    }, this.db);
  }

  async setDiscarded(id: string, discarded: boolean) {
    await runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      if (!await tx.procedureVideo.findUnique({ where: { id } })) throw new ApiError(404, '動画がありません');
      if (discarded && await tx.procedureVideoLink.count({ where: { videoId: id } })) throw new ApiError(409, '紐づいている動画は捨てられません');
      await tx.procedureVideo.update({ where: { id }, data: { discardedAt: discarded ? new Date() : null } });
    }, this.db);
  }

  async listPage(documentId: string, pageIndex: number) {
    const links = await this.db.procedureVideoLink.findMany({ where: { assemblyProcedureDocumentId: documentId, pageIndex }, orderBy: { sortOrder: 'asc' }, include: { video: true } });
    return links.map(({ video }) => ({ id: video.id, title: video.title, durationSeconds: video.durationSeconds, status: video.status }));
  }

  async replacePage(params: AssemblyProcedureEditActor & { documentId: string; pageIndex: number; videoIds: string[]; accessPassword?: string }) {
    await this.access.requireAccessPassword(params.accessPassword);
    await runAssemblyTransaction(async (tx) => {
      const [document] = await tx.$queryRaw<Array<{ status: string; isActive: boolean; isRevisionHead: boolean | null }>>`
        SELECT d."status", d."isActive", r."isRevisionHead" FROM "AssemblyProcedureDocument" d
        LEFT JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
        WHERE d."id" = ${params.documentId} FOR UPDATE OF d`;
      if (!document) throw new ApiError(404, '手順書が見つかりません');
      await new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(params.documentId, params.holderKey ?? null, tx, params.holderToken ?? null);
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
      const unfinished = await tx.procedureVideo.findFirst({ where: { id: { in: ids }, OR: [{ status: { not: 'READY' } }, { durationSeconds: null }] } });
      if (unfinished) throw new ApiError(409, '変換が終わってから紐づけてください');
      const tooLong = await tx.procedureVideo.findFirst({ where: { id: { in: ids }, durationSeconds: { gt: 10.5 } } });
      if (tooLong) throw new ApiError(400, `10 秒以内にトリミングしてください(いま ${tooLong.durationSeconds?.toFixed(1)} 秒)`);
      // A trim may have entered PENDING while a page editor held an old shelf snapshot.
      const trimming = await tx.procedureVideo.findFirst({ where: { id: { in: ids }, trimRequest: { not: Prisma.DbNull } } });
      if (trimming) throw new ApiError(409, 'トリミング処理中の動画は紐づけできません');
      await tx.procedureVideoLink.deleteMany({ where: { assemblyProcedureDocumentId: params.documentId, pageIndex: params.pageIndex } });
      if (ids.length) await tx.procedureVideoLink.createMany({ data: ids.map((videoId, sortOrder) => ({ videoId, sortOrder, assemblyProcedureDocumentId: params.documentId, pageIndex: params.pageIndex })) });
    }, this.db);
    return this.listPage(params.documentId, params.pageIndex);
  }
}
