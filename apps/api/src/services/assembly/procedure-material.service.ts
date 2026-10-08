import { AssemblyProcedureDraftImportService } from './assembly-procedure-draft-import.service.js';

import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';

export type ProcedureMaterialState = 'unplaced' | 'placed' | 'discarded' | 'all';
export class ProcedureMaterialService {
  constructor(
    private readonly db = defaultPrisma,
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
    private readonly importer: Pick<AssemblyProcedureDraftImportService, 'importDraft'> = new AssemblyProcedureDraftImportService(),
  ) {}

  async list(options: { state: ProcedureMaterialState; q?: string; limit: number }) {
    const where: Prisma.ProcedureMaterialWhereInput = {};
    if (options.state === 'unplaced') Object.assign(where, { documentId: null, placedAt: null, discardedAt: null });
    if (options.state === 'placed') Object.assign(where, { discardedAt: null, OR: [{ documentId: { not: null } }, { placedAt: { not: null } }] });
    if (options.state === 'discarded') where.discardedAt = { not: null };
    if (options.q) where.AND = [{ OR: [...new Set([options.q, options.q.normalize('NFKC')])].flatMap((q) => [{ subjectHint: { contains: q, mode: 'insensitive' as const } }, { originalFileName: { contains: q, mode: 'insensitive' as const } }]) }];
    const materials = await this.db.procedureMaterial.findMany({ where, orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: options.limit });
    // PDF and page text exists for search only; keep it out of the list payload.
    return materials.map((material) => material.kind === 'TEXT' ? material : { ...material, text: null });
  }

  async listRankRecordIds(state: 'unplaced' | 'placed') {
    const materials = await this.db.procedureMaterial.findMany({
      where: { discardedAt: null, ...(state === 'unplaced' ? { documentId: null, placedAt: null }
        : { OR: [{ documentId: { not: null } }, { placedAt: { not: null } }] }) },
      select: { id: true, gmailMessageId: true },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    return [...new Set(materials.map(row => row.gmailMessageId === null ? `material:${row.id}` : `mail:${row.gmailMessageId}`))];
  }

  async listRanked(recordIds: string[], options: { state: 'unplaced' | 'placed'; limit: number }) {
    const mailIds = recordIds.filter(id => id.startsWith('mail:')).map(id => id.slice(5));
    const materialIds = recordIds.filter(id => id.startsWith('material:')).map(id => id.slice(9));
    if (!mailIds.length && !materialIds.length) return [];
    const state = options.state === 'unplaced'
      ? { documentId: null, placedAt: null }
      : { OR: [{ documentId: { not: null } }, { placedAt: { not: null } }] };
    const materials = await this.db.procedureMaterial.findMany({
      where: { discardedAt: null, AND: [state, { OR: [
        { gmailMessageId: { in: mailIds } }, { id: { in: materialIds }, gmailMessageId: null },
      ] }] },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const byRecord = new Map<string, typeof materials>();
    for (const material of materials) {
      const key = material.gmailMessageId === null ? `material:${material.id}` : `mail:${material.gmailMessageId}`;
      const group = byRecord.get(key) ?? [];
      group.push(material);
      byRecord.set(key, group);
    }
    return [...new Set(recordIds)].flatMap(id => byRecord.get(id) ?? []).slice(0, options.limit);
  }

  async readFile(id: string) {
    const material = await this.db.procedureMaterial.findUnique({ where: { id } });
    if (!material || material.kind !== 'PHOTO' || !material.storageKey) throw new ApiError(404, '写真がありません');
    const bytes = await this.store.read(material.storageKey, { verifyIntegrity: true });
    return { bytes, contentType: material.contentType ?? 'application/octet-stream' };
  }

  async createDocument(id: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureMaterial" WHERE "id" = ${id} FOR UPDATE`;
      const material = await tx.procedureMaterial.findUnique({ where: { id } });
      if (!material) throw new ApiError(404, '素材がありません');
      if (material.kind !== 'PDF') throw new ApiError(400, 'PDF 素材だけ要領書を作成できます');
      if (material.documentId) throw new ApiError(409, 'この PDF からは作成済みです');
      if (material.discardedAt) throw new ApiError(409, '捨てた素材からは作成できません');
      if (!material.storageKey) throw new ApiError(400, 'PDF の原本がありません');
      const filename = material.originalFileName || '素材.pdf';
      const buffer = await this.store.read(material.storageKey, { verifyIntegrity: true });
      const document = await this.importer.importDraft({
        name: material.subjectHint || filename.replace(/\.[^.]+$/, ''),
        transaction: tx, avoidDuplicateName: true, buffer, mimetype: 'application/pdf', filename,
        source: { sourceType: 'MANUAL', sourceAttachmentName: filename },
      });
      await tx.procedureMaterial.update({ where: { id }, data: { documentId: document.id, placedAt: new Date() } });
      return { document: { id: document.id, name: document.name } };
    }, { timeout: 120_000 });
  }

  async unplace(id: string) {
    const updated = await this.db.procedureMaterial.updateMany({
      where: { id, OR: [{ kind: { not: 'PDF' } }, { documentId: null }] },
      data: { documentId: null, placedAt: null },
    });
    if (!updated.count) {
      if (!await this.db.procedureMaterial.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, '素材がありません');
      throw new ApiError(409, '要領書を作成済みの PDF は配置を取り消せません');
    }
  }

  async setDiscarded(id: string, discarded: boolean) {
    // The conditional update also guards concurrent placement in Phase 2b.
    const updated = await this.db.procedureMaterial.updateMany({
      where: { id, documentId: null, placedAt: null }, data: { discardedAt: discarded ? new Date() : null },
    });
    if (!updated.count) {
      if (!await this.db.procedureMaterial.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, '素材がありません');
      throw new ApiError(409, '配置済みの素材は変更できません');
    }
  }
}
