import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  assemblyCheckSheetProposalSchema,
  assemblyCheckSheetSaveSchema,
  type AssemblyCheckSheetImportPayload,
  type AssemblyCheckSheetRevisionPayload,
  type AssemblyCheckSheetSavePayload
} from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { getFileStorageRuntime } from '../../file-storage/file-storage-runtime.js';
import { FileStorageAlreadyExistsError } from '../../file-storage/file-storage-errors.js';
import { runAssemblyTransaction } from '../assembly-transaction.js';
import { normalizeCheckSheet } from './check-sheet-normalizer.js';
import { parseCheckSheetXlsx } from './check-sheet-xlsx-parser.js';

export const revisionInclude = {
  groups: { orderBy: { sortOrder: 'asc' as const } },
  items: { orderBy: { sortOrder: 'asc' as const } }
};
type StoredRevision = Prisma.AssemblyCheckSheetRevisionGetPayload<{ include: typeof revisionInclude }>;

export function serializeRevision(revision: StoredRevision): AssemblyCheckSheetRevisionPayload {
  const proposal = assemblyCheckSheetProposalSchema.parse({
    ...revision,
    items: revision.items.map((item) => ({
      ...item, groupNo: revision.groups.find((group) => group.id === item.groupId)?.groupNo
    }))
  });
  return {
    ...proposal, id: revision.id, revisionRootId: revision.revisionRootId,
    revisionNumber: revision.revisionNumber, isRevisionHead: revision.isRevisionHead,
    sourceAssetId: revision.sourceAssetId, layoutSnapshot: revision.layoutSnapshot,
    createdByUserId: revision.createdByUserId, createdAt: revision.createdAt.toISOString(),
    groups: proposal.groups.map((group, index) => ({ ...group, id: revision.groups[index].id })),
    items: proposal.items.map((item, index) => ({ ...item, id: revision.items[index].id, groupId: revision.items[index].groupId }))
  };
}

async function parseSource(buffer: Buffer, sheetName?: string) {
  try {
    return await parseCheckSheetXlsx(buffer, sheetName);
  } catch {
    throw new ApiError(400, 'チェックシートの形式またはシート名を確認してください');
  }
}

export class AssemblyCheckSheetService {
  async importWorkbook(buffer: Buffer, originalFileName: string, sheetName?: string): Promise<AssemblyCheckSheetImportPayload> {
    const parsed = await parseSource(buffer, sheetName);
    const proposal = assemblyCheckSheetProposalSchema.parse(normalizeCheckSheet(parsed));
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const storageKey = `assembly-check-sheet-sources/${sha256}.xlsx`;
    const store = getFileStorageRuntime().store;
    await store.initialize(['assembly-check-sheet-sources']);
    try {
      await store.write({ key: storageKey, data: buffer, mode: 'create', integrity: true });
    } catch (error) {
      if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
      // A repeated upload must never replace an original, including during concurrent imports.
      const existing = await store.read(storageKey, { verifyIntegrity: true });
      if (createHash('sha256').update(existing).digest('hex') !== sha256) throw error;
    }
    const asset = await prisma.assemblyCheckSheetAsset.upsert({
      where: { sha256 }, update: {},
      create: {
        sha256, storageKey, byteSize: buffer.length, originalFileName,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    });
    return { importId: asset.id, sheetNames: parsed.sheetNames, proposal };
  }

  async saveRevision(payload: AssemblyCheckSheetSavePayload, createdByUserId: string): Promise<AssemblyCheckSheetRevisionPayload> {
    const { proposal } = assemblyCheckSheetSaveSchema.parse(payload);
    const asset = await prisma.assemblyCheckSheetAsset.findUnique({ where: { id: payload.importId } });
    if (!asset) throw new ApiError(404, '取込元が見つかりません');
    await parseSource(await getFileStorageRuntime().store.read(asset.storageKey, { verifyIntegrity: true }), proposal.sourceSheetName);
    return runAssemblyTransaction(async (tx) => {
      const id = randomUUID();
      const revisionRootId = payload.revisionRootId ?? id;
      let revisionNumber = 1;
      if (payload.revisionRootId) {
        // Lock the stable root row, rather than the head that changes on every save.
        const roots = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "AssemblyCheckSheetRevision"
          WHERE "id" = ${revisionRootId} AND "revisionRootId" = ${revisionRootId}
          FOR UPDATE
        `;
        if (!roots.length) throw new ApiError(404, '改訂元が見つかりません');
        const previous = await tx.assemblyCheckSheetRevision.findFirstOrThrow({
          where: { revisionRootId }, orderBy: { revisionNumber: 'desc' }
        });
        revisionNumber = previous.revisionNumber + 1;
        await tx.assemblyCheckSheetRevision.updateMany({
          where: { revisionRootId, isRevisionHead: true }, data: { isRevisionHead: false }
        });
      }
      const { groups, items, ...metadata } = proposal;
      const savedGroups = groups.map((group) => ({ ...group, id: randomUUID() }));
      await tx.assemblyCheckSheetRevision.create({
        data: { ...metadata, id, revisionRootId, revisionNumber, sourceAssetId: asset.id, createdByUserId }
      });
      await tx.assemblyCheckSheetGroup.createMany({
        data: savedGroups.map((group) => ({ ...group, revisionId: id }))
      });
      await tx.assemblyCheckSheetItem.createMany({
        data: items.map(({ groupNo, ...item }) => ({
          ...item, revisionId: id, groupId: savedGroups.find((group) => group.groupNo === groupNo)!.id
        }))
      });
      return serializeRevision(await tx.assemblyCheckSheetRevision.findUniqueOrThrow({ where: { id }, include: revisionInclude }));
    });
  }

  async listRevisions(rootId?: string): Promise<AssemblyCheckSheetRevisionPayload[]> {
    const revisions = await prisma.assemblyCheckSheetRevision.findMany({
      where: rootId ? { revisionRootId: rootId } : { isRevisionHead: true },
      orderBy: [{ createdAt: 'desc' }, { revisionNumber: 'desc' }], include: revisionInclude
    });
    return revisions.map(serializeRevision);
  }

  async getRevision(id: string): Promise<AssemblyCheckSheetRevisionPayload> {
    const revision = await prisma.assemblyCheckSheetRevision.findUnique({ where: { id }, include: revisionInclude });
    if (!revision) throw new ApiError(404, 'チェックシートの版が見つかりません');
    return serializeRevision(revision);
  }
}
