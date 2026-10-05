import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';

export type ProcedureMaterialState = 'unplaced' | 'placed' | 'discarded' | 'all';
export class ProcedureMaterialService {
  constructor(private readonly db = defaultPrisma, private readonly store: DurableFileStorePort = getFileStorageRuntime().store) {}

  async list(options: { state: ProcedureMaterialState; q?: string; limit: number }) {
    const where: Prisma.ProcedureMaterialWhereInput = {};
    if (options.state === 'unplaced') Object.assign(where, { documentId: null, placedAt: null, discardedAt: null });
    if (options.state === 'placed') Object.assign(where, { discardedAt: null, OR: [{ documentId: { not: null } }, { placedAt: { not: null } }] });
    if (options.state === 'discarded') where.discardedAt = { not: null };
    if (options.q) where.subjectHint = { contains: options.q, mode: 'insensitive' };
    return this.db.procedureMaterial.findMany({ where, orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: options.limit });
  }

  async readFile(id: string) {
    const material = await this.db.procedureMaterial.findUnique({ where: { id } });
    if (!material || material.kind !== 'PHOTO' || !material.storageKey) throw new ApiError(404, '写真がありません');
    const bytes = await this.store.read(material.storageKey, { verifyIntegrity: true });
    return { bytes, contentType: material.contentType ?? 'application/octet-stream' };
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
