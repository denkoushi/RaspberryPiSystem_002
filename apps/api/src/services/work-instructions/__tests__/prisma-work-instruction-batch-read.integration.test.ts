import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { readPublishedWorkInstructionGroupsByKeys } from '../repositories/prisma-work-instruction-published-batch-read.js';
import { readPublishedWorkInstructionGroup } from '../repositories/prisma-work-instruction-read-queries.js';
import type { WorkInstructionGroupLookup } from '../repositories/work-instruction-repository.port.js';

/** Opt-in only: fixtures mutate an explicitly disposable loopback database. */
const enabled = process.env.WORK_INSTRUCTION_INTEGRATION === 'true';
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:\d+\//.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('WORK_INSTRUCTION_INTEGRATION requires a disposable loopback DATABASE_URL');
}
const describeIntegration = enabled ? describe : describe.skip;
const fixtureSystem = `batch-read-${randomUUID()}`;
const keyOf = (key: WorkInstructionGroupLookup) => JSON.stringify([key.partNumber, key.shootingTarget]);
const modified = new Date('2026-10-01T00:00:00Z');
const rowIds: string[] = [];
const assetIds: string[] = [];
const editAssetIds: string[] = [];
// Construct only when opted in; use the runtime adapter and query event logging.
function createQueryClient() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), log: [{ emit: 'event', level: 'query' }] });
}
let db: ReturnType<typeof createQueryClient>;
let queryCount = 0;

async function legacy(partNumber: string, itemId = 1, list = `${partNumber}-B`) {
  const asset = await db.workInstructionAsset.create({ data: {
    storageKey: `${fixtureSystem}/${randomUUID()}.png`, mimeType: 'image/png', sizeBytes: 1,
    sha256: 'a'.repeat(64), status: 'ACTIVE'
  } });
  assetIds.push(asset.id);
  const row = await db.workInstructionRow.create({ data: {
    sourceSystem: fixtureSystem, sourceList: list, sourceItemId: BigInt(itemId), sourceModified: modified,
    partNumber, shootingTarget: '研削', rawManifest: { fixtureSystem }, contentHash: 'a'.repeat(64),
    steps: { create: [{ step: 2n, text: 'second' }, { step: 1n, text: 'first', assetId: asset.id }] }
  }, include: { steps: true } });
  rowIds.push(row.id);
  return row;
}

async function published(partNumber: string, edited = false) {
  const row = await legacy(partNumber);
  const version = await db.workInstructionSourceVersion.create({ data: {
    rowId: row.id, sourceModified: modified, partNumber, shootingTarget: '研削',
    rawManifest: { fixtureSystem }, contentHash: 'b'.repeat(64),
    steps: { create: [{ step: 2n, text: 'published second' }, { step: 1n, text: 'published first', imageAssetId: row.steps.find((step) => step.step === 1n)!.assetId }] }
  } });
  const editAssetId = randomUUID();
  if (edited) editAssetIds.push(editAssetId);
  const revision = edited ? await db.workInstructionEditRevision.create({ data: {
    sourceVersionId: version.id, status: 'PUBLISHED', baseContentHash: version.contentHash,
    memoOverrides: { create: { sourceStep: 1n, migratedFromStep: 1n, baseStepFingerprint: 'fixture', text: '公開memo' } },
    overlays: { create: { sourceStep: 2n, migratedFromStep: 2n, baseStepFingerprint: 'fixture', kind: 'IMAGE',
      xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4,
      editAsset: { create: { id: editAssetId, storageKey: `${fixtureSystem}/${editAssetId}.png`, mimeType: 'image/png',
        sizeBytes: 1, sha256: 'd'.repeat(64), status: 'ACTIVE' } } } }
  } }) : null;
  await db.workInstructionSourcePublication.create({ data: {
    rowId: row.id, latestVersionId: version.id, publishedVersionId: version.id, publishedRevisionId: revision?.id
  } });
  return { row, version };
}

async function expectEquivalent(keys: WorkInstructionGroupLookup[]) {
  const batch = await readPublishedWorkInstructionGroupsByKeys(db, keys);
  for (const key of keys) expect(batch.get(keyOf(key))).toEqual(await readPublishedWorkInstructionGroup(db, key));
  return batch;
}

describeIntegration('published work-instruction batch reads', () => {
  beforeAll(async () => {
    db = createQueryClient();
    db.$on('query', () => { queryCount++; });
  });
  afterEach(async () => {
    const versions = await db.workInstructionSourceVersion.findMany({ where: { rowId: { in: rowIds } }, select: { id: true } });
    const versionIds = versions.map((version) => version.id);
    await db.workInstructionSourcePublication.deleteMany({ where: { rowId: { in: rowIds } } });
    await db.workInstructionEditRevision.deleteMany({ where: { sourceVersionId: { in: versionIds } } });
    await db.workInstructionEditAsset.deleteMany({ where: { id: { in: editAssetIds } } });
    await db.workInstructionSourceVersion.deleteMany({ where: { id: { in: versionIds } } });
    await db.workInstructionRow.deleteMany({ where: { id: { in: rowIds }, sourceSystem: fixtureSystem } });
    await db.workInstructionAsset.deleteMany({ where: { id: { in: assetIds } } });
    rowIds.length = 0;
    assetIds.length = 0;
    editAssetIds.length = 0;
  });
  afterAll(async () => { await db?.$disconnect(); });

  it('matches legacy-only reads before any publication exists globally', async (context) => {
    if (await db.workInstructionSourcePublication.count() !== 0) context.skip();
    const partNumber = `${fixtureSystem}-LEGACY`.toUpperCase();
    await legacy(partNumber, 2);
    await legacy(partNumber, 1, 'A');
    const key = { partNumber, shootingTarget: '研削' };
    const batch = await expectEquivalent([key, { ...key, partNumber: 'MISSING' }]);
    expect(batch.get(keyOf(key))?.rows.map((row) => row.source.itemId)).toEqual([1, 2]);
    expect(batch.get(keyOf(key))?.steps.map((step) => step.step)).toEqual([1, 2, 1, 2]);
  });

  it('matches published, edited, mixed legacy, moved, missing and normalized keys', async () => {
    const partNumber = `${fixtureSystem}-PUBLIC`.toUpperCase();
    const editedPart = `${fixtureSystem}-EDITED`.toUpperCase();
    const legacyPart = `${fixtureSystem}-LEGACY`.toUpperCase();
    const movedPart = `${fixtureSystem}-MOVED`.toUpperCase();
    const first = await published(partNumber);
    await legacy(partNumber, 1, 'A');
    await published(editedPart, true);
    await legacy(legacyPart);
    const latest = await db.workInstructionSourceVersion.create({ data: {
      rowId: first.row.id, sourceModified: new Date(modified.getTime() + 1000), partNumber: movedPart,
      shootingTarget: '研削', contentHash: 'c'.repeat(64), rawManifest: {}
    } });
    await db.workInstructionRow.update({ where: { id: first.row.id }, data: { partNumber: movedPart } });
    await db.workInstructionSourcePublication.update({ where: { rowId: first.row.id }, data: { latestVersionId: latest.id } });
    const keys = [partNumber, editedPart, legacyPart, movedPart, 'MISSING'].map((partNumber) => ({ partNumber, shootingTarget: '研削' }));
    const normalizedInput = { partNumber: ` ${partNumber.toLowerCase()} `, shootingTarget: ' 研削工程 ' };
    const batch = await expectEquivalent([...keys, normalizedInput, { partNumber: '', shootingTarget: '研削' }, keys[0]]);
    expect(batch.get(keyOf(keys[0]))?.updateAvailable).toBe(true);
    expect(batch.get(keyOf(keys[0]))?.rows.map((row) => row.source.list)).toEqual(['A', `${partNumber}-B`]);
    expect(batch.get(keyOf(keys[1]))?.rows[0].steps[0]).toMatchObject({ memoOverride: '公開memo', imageMimeType: 'image/png' });
    expect(batch.get(keyOf(keys[1]))?.rows[0].steps[1].overlays).toHaveLength(1);
    expect(batch.get(keyOf(keys[3]))).toBeNull();
    expect(batch.get(keyOf(normalizedInput))).toEqual(batch.get(keyOf(keys[0])));
    expect(batch.get(keyOf({ partNumber: '', shootingTarget: '研削' }))).toBeNull();
  });

  it('uses the same SQL count for one and many groups with the same relation shape', async () => {
    const keys = Array.from({ length: 5 }, (_, index) => ({ partNumber: `${fixtureSystem}-${index}`.toUpperCase(), shootingTarget: '研削' }));
    for (const key of keys) { await published(key.partNumber, true); await legacy(key.partNumber, 2); }
    queryCount = 0;
    await readPublishedWorkInstructionGroupsByKeys(db, keys.slice(0, 1));
    const singleCount = queryCount;
    queryCount = 0;
    await readPublishedWorkInstructionGroupsByKeys(db, keys);
    expect(queryCount).toBe(singleCount);
    expect(singleCount).toBeGreaterThan(0);
  });

  it('preserves results across the 200-key chunk boundary in one snapshot', async () => {
    const partNumber = `${fixtureSystem}-CHUNK`.toUpperCase();
    await published(partNumber, true);
    const keys = Array.from({ length: 201 }, (_, index) => ({ partNumber: index === 200 ? partNumber : `${fixtureSystem}-MISSING-${index}`, shootingTarget: '研削' }));
    await expectEquivalent(keys);
  });

  it('returns no entries and issues no SQL for empty input', async () => {
    queryCount = 0;
    expect(await readPublishedWorkInstructionGroupsByKeys(db, [])).toEqual(new Map());
    expect(queryCount).toBe(0);
  });
});
