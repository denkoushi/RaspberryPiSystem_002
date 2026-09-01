import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { computeWorkInstructionMemoFingerprint } from '../domain/editing.js';
import type { WorkInstructionPacket } from '../domain/types.js';
import { PrismaWorkInstructionEditRepository } from '../repositories/prisma-work-instruction-edit.repository.js';
import { PrismaWorkInstructionRepository } from '../repositories/prisma-work-instruction.repository.js';
import { WorkInstructionEditService } from '../work-instruction-edit.service.js';
import type { WorkInstructionEditFileStorePort } from '../work-instruction-edit-file-store.adapter.js';
import type { WorkInstructionFileStorePort } from '../work-instruction-file-store.adapter.js';

/** Opt-in only: this suite mutates an explicitly disposable loopback database. */
const integrationEnabled = process.env.WORK_INSTRUCTION_INTEGRATION === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;
if (integrationEnabled && !/^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:\d+\//.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('WORK_INSTRUCTION_INTEGRATION requires a disposable loopback DATABASE_URL');
}

const fixtureSystem = `SharePoint-edit-${process.pid}-${Date.now()}`;
const baseModified = new Date('2026-08-29T00:00:00.000Z');
const repository = new PrismaWorkInstructionRepository();
const editing = new PrismaWorkInstructionEditRepository();
const rowIds: string[] = [];
const versionIds: string[] = [];
const revisionIds: string[] = [];
const assetIds: string[] = [];
const editAssetIds: string[] = [];

function packet(input: {
  list: string;
  itemId: number;
  modified: Date;
  contentHash: string;
  partNumber?: string;
  shootingTarget?: string;
  text?: string;
  imageName?: string | null;
  imageHash?: string;
  imageAssetId?: string;
}): WorkInstructionPacket {
  const imageName = input.imageName ?? null;
  return {
    source: { system: fixtureSystem, list: input.list, itemId: input.itemId, modified: input.modified },
    partNumber: input.partNumber ?? 'MD004',
    shootingTarget: input.shootingTarget ?? '研削',
    rawManifest: { schema_version: 1, fixture: fixtureSystem, itemId: input.itemId },
    contentHash: input.contentHash,
    steps: [{ step: 1, text: input.text ?? `text-${input.contentHash.slice(0, 4)}`, imageName, imageHash: input.imageHash, imageAssetId: input.imageAssetId }]
  };
}

async function cleanFixtures(): Promise<void> {
  const rows = await prisma.workInstructionRow.findMany({ where: { sourceSystem: fixtureSystem }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  const versions = ids.length > 0
    ? await prisma.workInstructionSourceVersion.findMany({ where: { rowId: { in: ids } }, select: { id: true } })
    : [];
  const revisions = versions.length > 0
    ? await prisma.workInstructionEditRevision.findMany({ where: { sourceVersionId: { in: versions.map((version) => version.id) } }, select: { id: true } })
    : [];
  const editAssetWhere = revisions.length > 0 || versions.length > 0 || editAssetIds.length > 0
    ? {
      OR: [
        ...(revisions.length > 0 ? [{ ownerRevisionId: { in: revisions.map((revision) => revision.id) } }] : []),
        ...(versions.length > 0 ? [{ originSourceVersionId: { in: versions.map((version) => version.id) } }] : []),
        ...(editAssetIds.length > 0 ? [{ id: { in: editAssetIds } }] : [])
      ]
    }
    : undefined;
  if (revisions.length > 0) await prisma.workInstructionEditOverlay.deleteMany({ where: { revisionId: { in: revisions.map((revision) => revision.id) } } });
  if (versions.length > 0) await prisma.workInstructionSourceAssetDeletionAudit.deleteMany({ where: { sourceVersionId: { in: versions.map((version) => version.id) } } });
  if (ids.length > 0) await prisma.workInstructionSourcePublication.deleteMany({ where: { rowId: { in: ids } } });
  if (revisions.length > 0) {
    await prisma.workInstructionEditRevision.updateMany({ where: { id: { in: revisions.map((revision) => revision.id) } }, data: { supersedesRevisionId: null } });
    await prisma.workInstructionEditRevision.deleteMany({ where: { id: { in: revisions.map((revision) => revision.id) } } });
  }
  if (editAssetWhere) await prisma.workInstructionEditAsset.deleteMany({ where: editAssetWhere });
  if (versions.length > 0) {
    await prisma.workInstructionSourceVersionStep.deleteMany({ where: { sourceVersionId: { in: versions.map((version) => version.id) } } });
    await prisma.workInstructionSourceVersion.deleteMany({ where: { id: { in: versions.map((version) => version.id) } } });
  }
  if (ids.length > 0) await prisma.workInstructionRow.deleteMany({ where: { id: { in: ids } } });
  if (assetIds.length > 0) await prisma.workInstructionAsset.deleteMany({ where: { id: { in: assetIds }, steps: { none: {} }, sourceVersionSteps: { none: {} } } });
  rowIds.length = 0;
  versionIds.length = 0;
  revisionIds.length = 0;
  assetIds.length = 0;
  editAssetIds.length = 0;
}

async function apply(input: Parameters<typeof packet>[0]): Promise<{ rowId: string; sourceVersionId: string }> {
  const result = await repository.applyPacket({ packet: packet(input), stagedAssets: [] });
  expect(result.outcome).toBe('APPLIED');
  if (!result.rowId || !result.sourceVersionId) throw new Error('fixture packet did not create source version');
  rowIds.push(result.rowId);
  versionIds.push(result.sourceVersionId);
  return { rowId: result.rowId, sourceVersionId: result.sourceVersionId };
}

describeIntegration('work-instruction immutable versions and editing persistence', () => {
  beforeAll(async () => cleanFixtures());
  afterEach(async () => cleanFixtures());
  afterAll(async () => prisma.$disconnect());

  it('keeps the old published image/text visible after a newer import', async () => {
    const first = await apply({ list: 'List-public', itemId: 1, modified: baseModified, contentHash: '1'.repeat(64), text: '公開版本文' });
    await apply({ list: 'List-public', itemId: 1, modified: new Date(baseModified.getTime() + 60_000), contentHash: '2'.repeat(64), text: '再取込本文', partNumber: 'MD004', shootingTarget: '研削' });

    const group = await repository.readPublishedGroup({ partNumber: 'MD004', shootingTarget: '研削' });
    expect(group?.rows).toHaveLength(1);
    expect(group?.rows[0]?.contentHash).toBe('1'.repeat(64));
    expect(group?.rows[0]?.steps[0]?.text).toBe('公開版本文');
    expect(group?.updateAvailable).toBe(true);
    expect(first.rowId).toBe(group?.rows[0]?.id);
  });

  it('composes published rows with legacy rows but never leaks a versioned row moved to another group', async () => {
    const moved = await apply({ list: 'List-mixed', itemId: 2, modified: baseModified, contentHash: '3'.repeat(64), text: '旧グループ' });
    const legacy = await prisma.workInstructionRow.create({
      data: {
        id: randomUUID(), sourceSystem: fixtureSystem, sourceList: 'List-legacy', sourceItemId: 3n,
        sourceModified: baseModified, partNumber: 'MD004', shootingTarget: '研削', rawManifest: { legacy: true }, contentHash: '4'.repeat(64),
        steps: { create: [{ id: randomUUID(), step: 1n, text: 'legacy row', imageName: null }] }
      }
    });
    rowIds.push(legacy.id);
    const mixed = await repository.readPublishedGroup({ partNumber: 'MD004', shootingTarget: '研削' });
    expect(mixed?.rows.map((row) => row.id)).toEqual(expect.arrayContaining([moved.rowId, legacy.id]));

    await apply({ list: 'List-mixed', itemId: 2, modified: new Date(baseModified.getTime() + 60_000), contentHash: '5'.repeat(64), text: '別グループへ移動', shootingTarget: '切削' });
    const oldGroup = await repository.readPublishedGroup({ partNumber: 'MD004', shootingTarget: '研削' });
    const movedGroup = await repository.readPublishedGroup({ partNumber: 'MD004', shootingTarget: '切削' });
    expect(oldGroup?.rows.map((row) => row.id)).toEqual([moved.rowId, legacy.id]);
    expect(oldGroup?.rows.find((row) => row.id === moved.rowId)?.steps[0]?.text).toBe('旧グループ');
    expect(movedGroup).toBeNull();
  });

  it('rolls back every revision in an atomic group publish when one source is stale', async () => {
    const first = await apply({ list: 'List-group-a', itemId: 10, modified: baseModified, contentHash: 'a'.repeat(64) });
    const second = await apply({ list: 'List-group-b', itemId: 11, modified: baseModified, contentHash: 'b'.repeat(64) });
    const copied = await editing.createDraftRevisionGroup([
      { rowId: first.rowId },
      { rowId: second.rowId }
    ]);
    for (const item of copied) revisionIds.push(item.revision.id);
    await apply({ list: 'List-group-b', itemId: 11, modified: new Date(baseModified.getTime() + 60_000), contentHash: 'c'.repeat(64) });

    await expect(editing.publishRevisionGroup(copied.map((item) => ({
      revisionId: item.revision.id,
      expectedEditVersion: item.revision.editVersion
    })))).rejects.toMatchObject({ statusCode: 409, code: 'WORK_INSTRUCTION_SOURCE_CONFLICT' });
    const states = await prisma.workInstructionEditRevision.findMany({ where: { id: { in: revisionIds } }, select: { status: true } });
    expect(states).toHaveLength(2);
    expect(states.every((state) => state.status === 'DRAFT')).toBe(true);
  });

  it('serializes same-version saves so exactly one writer wins the optimistic edit version', async () => {
    const source = await apply({ list: 'List-save-race', itemId: 12, modified: baseModified, contentHash: 'f'.repeat(64) });
    const draft = await editing.createDraftRevision({ rowId: source.rowId, sourceVersionId: source.sourceVersionId });
    revisionIds.push(draft.revision.id);

    const input = {
      revisionId: draft.revision.id,
      expectedEditVersion: draft.revision.editVersion,
      expectedSourceVersionId: source.sourceVersionId,
      expectedContentHash: 'f'.repeat(64),
      elements: []
    } as const;
    const results = await Promise.allSettled([editing.saveOverlays(input), editing.saveOverlays(input)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ statusCode: 409, code: 'WORK_INSTRUCTION_EDIT_CONFLICT' });

    const persisted = await prisma.workInstructionEditRevision.findUniqueOrThrow({ where: { id: draft.revision.id }, select: { editVersion: true } });
    expect(persisted.editVersion).toBe(1);
  });

  it('saves memo overrides with the revision, keeps empty text, and preserves them through the legacy overlay adapter', async () => {
    const source = await apply({ list: 'List-memo-empty', itemId: 15, modified: baseModified, contentHash: '8'.repeat(64), text: '原本memo' });
    const draft = await editing.createDraftRevision({ rowId: source.rowId, sourceVersionId: source.sourceVersionId });
    revisionIds.push(draft.revision.id);
    const saved = await editing.saveDraft({
      revisionId: draft.revision.id,
      expectedEditVersion: draft.revision.editVersion,
      expectedSourceVersionId: source.sourceVersionId,
      expectedContentHash: '8'.repeat(64),
      elements: [],
      memoOverrides: [{ sourceStep: 1, text: '' }]
    });
    expect(saved.memoOverrides?.[0]).toMatchObject({ sourceStep: 1, text: '', migrationState: 'MIGRATED' });
    expect(await prisma.workInstructionSourceVersionStep.findUniqueOrThrow({
      where: { sourceVersionId_step: { sourceVersionId: source.sourceVersionId, step: 1n } },
      select: { text: true }
    })).toEqual({ text: '原本memo' });
    await editing.saveOverlays({
      revisionId: draft.revision.id,
      expectedEditVersion: saved.editVersion,
      expectedSourceVersionId: source.sourceVersionId,
      expectedContentHash: '8'.repeat(64),
      elements: []
    });
    expect(await prisma.workInstructionEditMemoOverride.count({ where: { revisionId: draft.revision.id } })).toBe(1);
    expect(await prisma.workInstructionEditMemoOverride.findFirstOrThrow({ where: { revisionId: draft.revision.id }, select: { text: true } })).toEqual({ text: '' });
  });

  it('rejects two memo overrides assigned to the same target step before the database unique constraint', async () => {
    const source = await apply({ list: 'List-memo-duplicate-target', itemId: 17, modified: baseModified, contentHash: 'b'.repeat(64), text: '原本memo' });
    const draft = await editing.createDraftRevision({ rowId: source.rowId, sourceVersionId: source.sourceVersionId });
    revisionIds.push(draft.revision.id);

    await expect(editing.saveDraft({
      revisionId: draft.revision.id,
      expectedEditVersion: draft.revision.editVersion,
      expectedSourceVersionId: source.sourceVersionId,
      expectedContentHash: 'b'.repeat(64),
      elements: [],
      memoOverrides: [
        { sourceStep: 1, migratedFromStep: 1, text: 'memo-1' },
        { sourceStep: 1, migratedFromStep: 2, text: 'memo-2' }
      ]
    })).rejects.toMatchObject({ statusCode: 400, code: 'WORK_INSTRUCTION_DUPLICATE_MEMO_TARGET' });
  });

  it('requires KEEP or USE_SOURCE for a source-memo migration and validates KEEP against the current target fingerprint', async () => {
    const first = await apply({ list: 'List-memo-migration', itemId: 16, modified: baseModified, contentHash: '9'.repeat(64), text: '旧memo' });
    const firstDraft = await editing.createDraftRevision({ rowId: first.rowId, sourceVersionId: first.sourceVersionId });
    revisionIds.push(firstDraft.revision.id);
    const firstSaved = await editing.saveDraft({
      revisionId: firstDraft.revision.id,
      expectedEditVersion: 0,
      expectedSourceVersionId: first.sourceVersionId,
      expectedContentHash: '9'.repeat(64),
      elements: [],
      memoOverrides: [{ sourceStep: 1, text: '編集memo' }]
    });
    await editing.publishRevision({ revisionId: firstDraft.revision.id, expectedEditVersion: firstSaved.editVersion });
    const second = await apply({
      list: 'List-memo-migration',
      itemId: 16,
      modified: new Date(baseModified.getTime() + 60_000),
      contentHash: 'a'.repeat(64),
      text: '新memo'
    });
    const secondDraft = await editing.createDraftRevision({ rowId: second.rowId, sourceVersionId: second.sourceVersionId });
    revisionIds.push(secondDraft.revision.id);
    expect(secondDraft.copy.memo).toMatchObject({ copiedCount: 1, needsReviewCount: 1 });
    expect(secondDraft.revision.memoOverrides?.[0]).toMatchObject({ migrationState: 'NEEDS_REVIEW', text: '編集memo' });
    const currentFingerprint = computeWorkInstructionMemoFingerprint((await editing.listSourceVersions(second.rowId)).find((version) => version.id === second.sourceVersionId)!.steps[0]!);

    await expect(editing.saveDraft({
      revisionId: secondDraft.revision.id,
      expectedEditVersion: secondDraft.revision.editVersion,
      expectedSourceVersionId: second.sourceVersionId,
      expectedContentHash: 'a'.repeat(64),
      elements: [],
      memoOverrides: [{ sourceStep: 1, migratedFromStep: 1, baseStepFingerprint: currentFingerprint, migrationState: 'MIGRATED', text: '編集memo' }]
    })).rejects.toMatchObject({ statusCode: 409, code: 'WORK_INSTRUCTION_MEMO_MIGRATION_RESOLUTION_REQUIRED' });

    await expect(editing.saveDraft({
      revisionId: secondDraft.revision.id,
      expectedEditVersion: secondDraft.revision.editVersion,
      expectedSourceVersionId: second.sourceVersionId,
      expectedContentHash: 'a'.repeat(64),
      elements: [],
      memoOverrides: []
    })).rejects.toMatchObject({ statusCode: 409, code: 'WORK_INSTRUCTION_MEMO_ACTION_REQUIRED' });

    const kept = await editing.saveDraft({
      revisionId: secondDraft.revision.id,
      expectedEditVersion: secondDraft.revision.editVersion,
      expectedSourceVersionId: second.sourceVersionId,
      expectedContentHash: 'a'.repeat(64),
      elements: [],
      memoOverrides: [{ sourceStep: 1, migratedFromStep: 1, action: 'KEEP', expectedTargetStepFingerprint: currentFingerprint, text: '編集memo' }]
    });
    expect(kept.memoOverrides?.[0]).toMatchObject({ migrationState: 'MIGRATED', text: '編集memo', targetStepFingerprint: currentFingerprint });
    await expect(editing.saveDraft({
      revisionId: secondDraft.revision.id,
      expectedEditVersion: kept.editVersion,
      expectedSourceVersionId: second.sourceVersionId,
      expectedContentHash: 'a'.repeat(64),
      elements: [],
      memoOverrides: [{ sourceStep: 1, migratedFromStep: 1, action: 'USE_SOURCE', text: '' }]
    })).resolves.toMatchObject({ editVersion: kept.editVersion + 1, memoOverrides: [] });
    await expect(editing.publishRevision({ revisionId: secondDraft.revision.id, expectedEditVersion: kept.editVersion + 1 })).resolves.toMatchObject({ migration: { memo: { needsReviewCount: 0, unassignedCount: 0 } } });
  });

  it('rejects cross-row overlay copies and an editor group that does not contain the target', async () => {
    const source = await apply({ list: 'List-copy-source', itemId: 13, modified: baseModified, contentHash: '1'.repeat(64) });
    const target = await apply({ list: 'List-copy-target', itemId: 14, modified: baseModified, contentHash: '2'.repeat(64) });
    const sourceDraft = await editing.createDraftRevision({ rowId: source.rowId, sourceVersionId: source.sourceVersionId });
    revisionIds.push(sourceDraft.revision.id);

    await expect(editing.createDraftRevision({
      rowId: target.rowId,
      sourceVersionId: target.sourceVersionId,
      copyFromRevisionId: sourceDraft.revision.id
    })).rejects.toMatchObject({ statusCode: 409, code: 'WORK_INSTRUCTION_CROSS_ROW_COPY_NOT_ALLOWED' });

    await expect(editing.createDraftRevisionGroup([{ rowId: target.rowId, sourceVersionId: target.sourceVersionId }], {
      partNumber: 'NOT-IN-GROUP',
      shootingTarget: '研削'
    })).rejects.toMatchObject({ statusCode: 409, code: 'WORK_INSTRUCTION_GROUP_MEMBERSHIP_CONFLICT' });
  });

  it('claims ACTIVE unreferenced edit assets as cleanup candidates', async () => {
    const assetId = randomUUID();
    editAssetIds.push(assetId);
    const now = new Date('2026-08-30T00:00:00.000Z');
    await prisma.workInstructionEditAsset.create({
      data: {
        id: assetId,
        storageKey: `work-instruction-assets/editing/${assetId}.png`,
        mimeType: 'image/png',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
        status: 'ACTIVE',
        activatedAt: new Date(now.getTime() - 60_000),
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000)
      }
    });

    const candidates = await editing.claimEditAssetCleanupCandidates({ now, limit: 10 });
    expect(candidates.map((candidate) => candidate.assetId)).toContain(assetId);
    await expect(prisma.workInstructionEditAsset.findUniqueOrThrow({ where: { id: assetId }, select: { status: true } })).resolves.toEqual({ status: 'DELETE_PENDING' });
  });

  it('records source-image deletion audit idempotently and preserves the operator tombstone', async () => {
    const assetId = randomUUID();
    assetIds.push(assetId);
    const bytesHash = 'd'.repeat(64);
    const staged = await repository.stageAssets({ assets: [{
      assetId, imageName: 'source.jpg', storageKey: `${fixtureSystem}/source.jpg`, mimeType: 'image/jpeg', sizeBytes: 1, sha256: bytesHash
    }] });
    const first = await repository.applyPacket({
      packet: packet({ list: 'List-delete', itemId: 20, modified: baseModified, contentHash: 'd'.repeat(64), imageName: 'source.jpg', imageHash: bytesHash, imageAssetId: assetId }),
      stagedAssets: staged
    });
    expect(first.rowId && first.sourceVersionId).toBeTruthy();
    rowIds.push(first.rowId!);
    versionIds.push(first.sourceVersionId!);
    await repository.applyPacket({ packet: packet({ list: 'List-delete', itemId: 20, modified: new Date(baseModified.getTime() + 60_000), contentHash: 'e'.repeat(64), imageName: null }), stagedAssets: [] });
    const versions = await editing.listSourceVersions(first.rowId!);
    const newest = versions.find((version) => version.contentHash === 'e'.repeat(64));
    expect(newest).toBeTruthy();
    const draft = await editing.createDraftRevision({ rowId: first.rowId!, sourceVersionId: newest!.id });
    revisionIds.push(draft.revision.id);
    await editing.publishRevision({ revisionId: draft.revision.id, expectedEditVersion: 0 });

    let sourceDeleteCalls = 0;
    const sourceFiles: WorkInstructionFileStorePort = {
      writeStagedAssets: async () => [],
      read: async () => Buffer.from('source-image'),
      delete: async () => { sourceDeleteCalls += 1; }
    };
    const editFiles: WorkInstructionEditFileStorePort = {
      write: async () => ({ assetId: randomUUID(), storageKey: 'work-instruction-assets/editing/test.png', mimeType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64) }),
      read: async () => Buffer.from('edit-image'),
      delete: async () => undefined
    };
    const service = new WorkInstructionEditService(
      editing,
      editFiles,
      sourceFiles,
      { requireAccessPassword: async () => undefined }
    );

    const requested = await service.deleteSourceAsset({ sourceVersionId: first.sourceVersionId!, assetId, requestedBy: 'admin-user' });
    const repeated = await service.deleteSourceAsset({ sourceVersionId: first.sourceVersionId!, assetId, requestedBy: 'admin-user' });
    expect(requested.status).toBe('DELETED');
    expect(repeated.status).toBe('DELETED');
    expect(sourceDeleteCalls).toBe(1);
    const step = await prisma.workInstructionSourceVersionStep.findFirstOrThrow({ where: { sourceVersionId: first.sourceVersionId! } });
    const audit = await prisma.workInstructionSourceAssetDeletionAudit.findUniqueOrThrow({ where: { id: requested.auditId } });
    expect(step).toMatchObject({ imageAssetId: null, imageDeletedBy: 'admin-user' });
    expect(audit.status).toBe('DELETED');
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: assetId } })).toBeNull();
  });

  it('keeps a failed source deletion retryable until physical deletion and DB completion both succeed', async () => {
    const assetId = randomUUID();
    assetIds.push(assetId);
    const bytesHash = 'e'.repeat(64);
    const staged = await repository.stageAssets({ assets: [{
      assetId, imageName: 'retry.jpg', storageKey: `${fixtureSystem}/retry.jpg`, mimeType: 'image/jpeg', sizeBytes: 1, sha256: bytesHash
    }] });
    const first = await repository.applyPacket({
      packet: packet({ list: 'List-delete-retry', itemId: 21, modified: baseModified, contentHash: '6'.repeat(64), imageName: 'retry.jpg', imageHash: bytesHash, imageAssetId: assetId }),
      stagedAssets: staged
    });
    expect(first.rowId && first.sourceVersionId).toBeTruthy();
    rowIds.push(first.rowId!);
    versionIds.push(first.sourceVersionId!);
    await repository.applyPacket({ packet: packet({ list: 'List-delete-retry', itemId: 21, modified: new Date(baseModified.getTime() + 60_000), contentHash: '7'.repeat(64), imageName: null }), stagedAssets: [] });
    const newest = (await editing.listSourceVersions(first.rowId!)).find((version) => version.contentHash === '7'.repeat(64));
    expect(newest).toBeTruthy();
    const draft = await editing.createDraftRevision({ rowId: first.rowId!, sourceVersionId: newest!.id });
    revisionIds.push(draft.revision.id);
    await editing.publishRevision({ revisionId: draft.revision.id, expectedEditVersion: 0 });

    let failPhysicalDelete = true;
    const sourceFiles: WorkInstructionFileStorePort = {
      writeStagedAssets: async () => [],
      read: async () => Buffer.from('source-image'),
      delete: async () => {
        if (failPhysicalDelete) throw new Error('temporary source storage outage');
      }
    };
    const editFiles: WorkInstructionEditFileStorePort = {
      write: async () => ({ assetId: randomUUID(), storageKey: 'work-instruction-assets/editing/test.png', mimeType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64) }),
      read: async () => Buffer.from('edit-image'),
      delete: async () => undefined
    };
    const service = new WorkInstructionEditService(
      editing,
      editFiles,
      sourceFiles,
      { requireAccessPassword: async () => undefined }
    );

    const failed = await service.deleteSourceAsset({ sourceVersionId: first.sourceVersionId!, assetId, requestedBy: 'admin-user' });
    expect(failed.status).toBe('FAILED');
    const failedAudit = await prisma.workInstructionSourceAssetDeletionAudit.findFirstOrThrow({ where: { sourceVersionId: first.sourceVersionId!, assetId } });
    expect(failedAudit.status).toBe('FAILED');
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: assetId }, select: { status: true } })).toEqual({ status: 'DELETE_PENDING' });

    failPhysicalDelete = false;
    const retried = await service.deleteSourceAsset({ sourceVersionId: first.sourceVersionId!, assetId, requestedBy: 'admin-user' });
    expect(retried.status).toBe('DELETED');
    expect(await prisma.workInstructionSourceAssetDeletionAudit.findUniqueOrThrow({ where: { id: failed.auditId! }, select: { status: true } })).toEqual({ status: 'DELETED' });
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: assetId } })).toBeNull();
  });
});
