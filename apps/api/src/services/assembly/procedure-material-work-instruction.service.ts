import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import sharp from 'sharp';

import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { FileStorageAlreadyExistsError } from '../file-storage/file-storage-errors.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import type { WorkInstructionGroupSummaryView, WorkInstructionGroupView } from '../work-instructions/domain/types.js';
import type { WorkInstructionReadService } from '../work-instructions/work-instruction-read.service.js';
import { getWorkInstructionServices } from '../work-instructions/work-instruction-service.factory.js';

type Reader = Pick<WorkInstructionReadService, 'readPublishedGroup' | 'readPublishedGroups' | 'searchPublishedGroups' | 'readAsset'>;
type Candidate = {
  candidateKey: string; partNumber: string; shootingTarget: string; step: number; memo: string;
  assetId: string; sourceModified: Date; originalFileName: string | null;
  workInstructionRef: { rowId: string; sourceVersionId: string; step: number; assetId: string;
    partNumber: string; shootingTarget: string; memo: string; sourceSystem: string; sourceList: string };
};

function candidates(group: WorkInstructionGroupView): Candidate[] {
  return group.rows.flatMap((row) => {
    // Legacy rows lack an immutable source version identity and cannot supply the import key.
    const sourceVersionId = row.publication?.publishedVersionId;
    if (!sourceVersionId) return [];
    return row.steps.flatMap((step) => {
      // The public read projection exposes only ACTIVE, non-deleted source images.
      if (!step.imageAssetId || !step.imageStorageKey || !step.imageMimeType) return [];
      const memo = step.memoOverride ?? step.text;
      const workInstructionRef = { rowId: row.id, sourceVersionId, step: step.step, assetId: step.imageAssetId,
        partNumber: group.partNumber, shootingTarget: group.shootingTarget, memo, sourceSystem: row.source.system, sourceList: row.source.list };
      return [{ candidateKey: `work-instruction:${row.id}:${sourceVersionId}:${step.step}:image:${step.imageAssetId}`,
        partNumber: group.partNumber, shootingTarget: group.shootingTarget, step: step.step, memo,
        assetId: step.imageAssetId, sourceModified: row.source.modified, originalFileName: step.imageName, workInstructionRef }];
    });
  });
}

export class ProcedureMaterialWorkInstructionService {
  constructor(
    private readonly db = defaultPrisma,
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
    private readonly reader: () => Reader = () => getWorkInstructionServices().read,
  ) {}

  private async groups(read: Reader, q?: string): Promise<WorkInstructionGroupSummaryView[]> {
    const groups: WorkInstructionGroupSummaryView[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = q ? await read.searchPublishedGroups({ query: q, limit: 500, offset }) : null;
      const items = page?.groups ?? await read.readPublishedGroups({ limit: 500, offset });
      groups.push(...items);
      if (page ? !page.hasMore : items.length < 500) break;
    }
    // Search also matches memo text; this shelf searches only part number / target.
    const query = q?.normalize('NFKC').trim().toLowerCase();
    return groups.filter((group) => !query || [group.partNumber, group.shootingTarget].some((text) => text.normalize('NFKC').toLowerCase().includes(query)))
      .sort((a, b) => b.latestModified.getTime() - a.latestModified.getTime());
  }

  async list(options: { q?: string; limit?: number } = {}) {
    const read = this.reader();
    const limit = Math.max(1, Math.min(options.limit ?? 60, 1000));
    const items: Candidate[] = [];
    for (const summary of await this.groups(read, options.q?.trim())) {
      const group = await read.readPublishedGroup(summary);
      if (group) items.push(...candidates(group).slice(0, limit - items.length));
      if (items.length >= limit) break;
    }
    const imported = await this.db.procedureMaterial.findMany({ where: { gmailDedupeKey: { in: items.map((item) => item.candidateKey) } }, select: { gmailDedupeKey: true } });
    const keys = new Set(imported.map((item) => item.gmailDedupeKey));
    return { items: items.map(({ candidateKey, partNumber, shootingTarget, step, memo, assetId, sourceModified }) => ({
      candidateKey, partNumber, shootingTarget, step, memo: memo.slice(0, 200), assetId, sourceModified, alreadyImported: keys.has(candidateKey),
    })) };
  }

  private async saveOriginal(key: string, bytes: Buffer) {
    try { await this.store.write({ key, data: bytes, mode: 'create', integrity: true }); }
    catch (error) {
      if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
      if (!(await this.store.read(key, { verifyIntegrity: true })).equals(bytes)) throw new Error('Procedure material identity conflict');
    }
  }

  private async importCandidate(read: Reader, candidate: Candidate): Promise<'imported' | 'duplicate'> {
    const image = await read.readAsset(candidate.assetId);
    if (!image || image.asset.status !== 'ACTIVE') throw new Error('写真がありません');
    if (await this.db.procedureMaterial.findUnique({ where: { gmailDedupeKey: candidate.candidateKey } })) return 'duplicate';
    const { bytes, asset } = image;
    const metadata = await sharp(bytes).metadata();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `procedure-materials/${sha256}/original`;
    const data: Prisma.ProcedureMaterialCreateInput = {
      origin: 'WORK_INSTRUCTION', kind: 'PHOTO', workInstructionRef: candidate.workInstructionRef,
      gmailDedupeKey: candidate.candidateKey, subjectHint: `${candidate.partNumber} ${candidate.shootingTarget} 手順${candidate.step}`,
      originalFileName: candidate.originalFileName, contentType: asset.mimeType, byteSize: bytes.length,
      sha256, storageKey, width: metadata.width, height: metadata.height, receivedAt: new Date(),
    };
    await this.saveOriginal(storageKey, bytes);
    try { await this.db.procedureMaterial.create({ data }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002'
        || !await this.db.procedureMaterial.findUnique({ where: { gmailDedupeKey: candidate.candidateKey } })) throw error;
      return 'duplicate';
    }
    try { await this.store.stat(storageKey); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.saveOriginal(storageKey, bytes); }
    return 'imported';
  }

  async import(items: Array<{ candidateKey: string; partNumber: string; shootingTarget: string }>) {
    const result = { imported: 0, duplicate: 0, failed: [] as Array<{ candidateKey: string; reason: string }> };
    const read = this.reader();
    const groups = new Map<string, Promise<Candidate[]>>();
    for (const { candidateKey, partNumber, shootingTarget } of items) {
      try {
        // Client metadata only locates the group; identities and saved values come from the public read.
        const groupKey = JSON.stringify([partNumber, shootingTarget]);
        let groupCandidates = groups.get(groupKey);
        if (!groupCandidates) {
          groupCandidates = read.readPublishedGroup({ partNumber, shootingTarget })
            .then((group) => group ? candidates(group) : []);
          groups.set(groupKey, groupCandidates);
        }
        const candidate = (await groupCandidates).find((item) => item.candidateKey === candidateKey);
        if (!candidate) throw new Error('候補がありません');
        result[await this.importCandidate(read, candidate)]++;
      } catch (error) { result.failed.push({ candidateKey, reason: error instanceof Error ? error.message : String(error) }); }
    }
    return result;
  }
}
