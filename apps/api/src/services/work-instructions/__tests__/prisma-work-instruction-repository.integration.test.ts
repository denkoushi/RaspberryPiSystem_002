import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import type {
  WorkInstructionAssetInput,
  WorkInstructionPacket,
  WorkInstructionStagedAsset,
} from '../domain/types.js';
import { PrismaWorkInstructionRepository } from '../repositories/prisma-work-instruction.repository.js';

/**
 * This file is intentionally opt-in.  It mutates the database and therefore
 * must only be run with the disposable validation harness (or an equivalent
 * loopback database), never with the repository's shared test database.
 */
const integrationEnabled = process.env.WORK_INSTRUCTION_INTEGRATION === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;

if (integrationEnabled) {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!/^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:\d+\//.test(databaseUrl)) {
    throw new Error('WORK_INSTRUCTION_INTEGRATION requires a disposable loopback DATABASE_URL');
  }
}

const fixtureToken = `WIIT-${process.pid}-${Date.now()}`;
const sourceSystem = `SharePoint-${fixtureToken}`;
const assetPrefix = `${fixtureToken}/`;
const messagePrefix = `gmail-${fixtureToken}-`;
const baseModified = new Date('2026-08-29T00:00:00.000Z');
const groupPart = 'MD004121632';
const groupTarget = '研削';

function source(list: string, itemId: number, modified: Date) {
  return { system: sourceSystem, list, itemId, modified };
}

function packet(input: {
  list?: string;
  itemId: number;
  modified: Date;
  contentHash: string;
  partNumber?: string | null;
  shootingTarget?: string | null;
  steps?: WorkInstructionPacket['steps'];
  rawManifest?: WorkInstructionPacket['rawManifest'];
}): WorkInstructionPacket {
  return {
    source: source(input.list ?? 'List-A', input.itemId, input.modified),
    partNumber: input.partNumber === undefined ? groupPart : input.partNumber,
    shootingTarget: input.shootingTarget === undefined ? groupTarget : input.shootingTarget,
    rawManifest: input.rawManifest ?? { schema_version: 1, fixture: fixtureToken, item_id: input.itemId },
    steps: input.steps ?? [],
    contentHash: input.contentHash,
  };
}

function asset(input: {
  name: string;
  suffix: string;
  digest?: string;
}): WorkInstructionAssetInput {
  return {
    assetId: `${fixtureToken}-${input.suffix}`,
    imageName: input.name,
    storageKey: `${assetPrefix}${input.suffix}.jpeg`,
    mimeType: 'image/jpeg',
    sizeBytes: 4,
    sha256: (input.digest ?? input.suffix[0] ?? 'a').repeat(64).slice(0, 64),
  };
}

function imageStep(step: number, imageName: string, imageHash: string) {
  return { step, text: `step-${step}`, imageName, imageHash };
}

async function cleanupFixtures(): Promise<void> {
  const rows = await prisma.workInstructionRow.findMany({
    where: { sourceSystem },
    select: { id: true },
  });
  if (rows.length > 0) {
    await prisma.workInstructionRow.deleteMany({ where: { sourceSystem } });
  }
  await prisma.workInstructionImportMessage.deleteMany({
    where: { gmailMessageId: { startsWith: messagePrefix } },
  });
  await prisma.workInstructionAsset.deleteMany({
    where: { storageKey: { startsWith: assetPrefix }, steps: { none: {} } },
  });
}

describeIntegration('Prisma work-instruction repository (isolated integration)', () => {
  const repository = new PrismaWorkInstructionRepository();
  let concurrentClientA: PrismaClient | undefined;
  let concurrentClientB: PrismaClient | undefined;

  beforeAll(async () => {
    await cleanupFixtures();
  });

  afterEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await concurrentClientA?.$disconnect();
    await concurrentClientB?.$disconnect();
    await prisma.$disconnect();
  });

  it('applies one source tuple atomically and distinguishes newer, stale, duplicate, conflict, and lists', async () => {
    const first = asset({ name: '640_photo_1.jpeg', suffix: 'asset-v1', digest: 'a' });
    const stagedFirst = await repository.stageAssets({ assets: [first], now: baseModified });
    const firstPacket = packet({
      itemId: 640,
      modified: baseModified,
      contentHash: '1'.repeat(64),
      steps: [imageStep(1, first.imageName, first.sha256)],
    });

    const applied = await repository.applyPacket({ packet: firstPacket, stagedAssets: stagedFirst, now: baseModified });
    expect(applied.outcome).toBe('APPLIED');
    expect(applied.rowId).toBeTruthy();
    const firstRowId = applied.rowId!;

    const duplicate = await repository.applyPacket({ packet: firstPacket, stagedAssets: stagedFirst, now: baseModified });
    expect(duplicate).toMatchObject({ outcome: 'DUPLICATE', rowId: firstRowId, displacedAssetIds: [] });

    const second = asset({ name: '640_photo_2.jpeg', suffix: 'asset-v2', digest: 'b' });
    const stagedSecond = await repository.stageAssets({ assets: [second], now: new Date(baseModified.getTime() + 1000) });
    const secondModified = new Date(baseModified.getTime() + 60_000);
    const secondPacket = packet({
      itemId: 640,
      modified: secondModified,
      contentHash: '2'.repeat(64),
      steps: [imageStep(1, second.imageName, second.sha256)],
    });
    const updated = await repository.applyPacket({ packet: secondPacket, stagedAssets: stagedSecond, now: secondModified });
    expect(updated).toMatchObject({ outcome: 'APPLIED', rowId: firstRowId });
    expect(updated.displacedAssetIds).toContain(first.assetId);

    const stale = await repository.applyPacket({ packet: firstPacket, stagedAssets: stagedFirst, now: secondModified });
    expect(stale).toMatchObject({ outcome: 'STALE', rowId: firstRowId, displacedAssetIds: [] });

    const conflict = packet({
      itemId: 640,
      modified: secondModified,
      contentHash: '3'.repeat(64),
      steps: [],
      rawManifest: { schema_version: 1, fixture: fixtureToken, changed: true },
    });
    const conflicted = await repository.applyPacket({ packet: conflict, stagedAssets: [], now: secondModified });
    expect(conflicted).toMatchObject({ outcome: 'CONFLICT', rowId: firstRowId, displacedAssetIds: [] });

    const sameItemDifferentList = packet({
      list: 'List-B',
      itemId: 640,
      modified: baseModified,
      contentHash: '4'.repeat(64),
      steps: [],
    });
    const secondList = await repository.applyPacket({ packet: sameItemDifferentList, stagedAssets: [], now: baseModified });
    expect(secondList.outcome).toBe('APPLIED');
    expect(secondList.rowId).not.toBe(firstRowId);

    const rows = await repository.readRows({
      partNumber: ` ${groupPart.toLowerCase()} `,
      shootingTarget: '研削工程',
      includeUnclassified: false,
      limit: 20,
      offset: 0,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.source.list)).toEqual(['List-A', 'List-B']);
    expect(rows[0]?.steps[0]).toMatchObject({
      imageName: second.imageName,
      imageAssetId: second.assetId,
      imageStorageKey: second.storageKey,
      imageMimeType: 'image/jpeg',
      imageSha256: second.sha256,
    });
    expect(await repository.readAsset(first.assetId)).toBeNull();
    expect(await repository.readAsset(second.assetId)).toMatchObject({ status: 'ACTIVE' });

    for (let itemId = 700; itemId < 709; itemId += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await repository.applyPacket({
        packet: packet({
          itemId,
          modified: new Date(baseModified.getTime() + itemId),
          contentHash: `${itemId}`.padStart(64, '0'),
          steps: [{ step: 1, text: `group-${itemId}`, imageName: null }],
        }),
        stagedAssets: [],
      });
      expect(result.outcome).toBe('APPLIED');
    }

    const groups = await repository.readGroups({
      partNumber: groupPart,
      shootingTarget: '研削工程',
      limit: 20,
      offset: 0,
    });
    expect(groups).toContainEqual(expect.objectContaining({
      partNumber: groupPart,
      shootingTarget: groupTarget,
      rowCount: 11,
      stepCount: 10,
    }));
    const group = await repository.readGroup({ partNumber: groupPart, shootingTarget: groupTarget });
    expect(group?.rows).toHaveLength(11);
    expect(group?.rows.map((row) => row.source.itemId)).toEqual([640, 640, 700, 701, 702, 703, 704, 705, 706, 707, 708]);
    expect(group?.steps).toHaveLength(10);
  });

  it('rolls back a malformed nested step write without leaving a row or steps', async () => {
    const malformed = packet({
      itemId: 901,
      modified: baseModified,
      contentHash: '9'.repeat(64),
      steps: [
        { step: 1, text: 'first', imageName: null },
        { step: 1, text: 'duplicate', imageName: null },
      ],
    });
    await expect(repository.applyPacket({ packet: malformed, stagedAssets: [] })).rejects.toThrow();
    expect(await prisma.workInstructionRow.findUnique({
      where: {
        sourceSystem_sourceList_sourceItemId: {
          sourceSystem,
          sourceList: 'List-A',
          sourceItemId: 901,
        },
      },
    })).toBeNull();
    expect(await prisma.workInstructionStep.count({
      where: { row: { sourceSystem, sourceList: 'List-A', sourceItemId: 901 } },
    })).toBe(0);
  });

  it('round-trips safe-integer source and step values through BIGINT columns', async () => {
    const safeBoundary = Number.MAX_SAFE_INTEGER;
    const result = await repository.applyPacket({
      packet: packet({
        itemId: safeBoundary,
        modified: baseModified,
        contentHash: '8'.repeat(64),
        steps: [{ step: safeBoundary, text: 'safe bigint boundary', imageName: null }],
      }),
      stagedAssets: [],
    });

    expect(result.outcome).toBe('APPLIED');
    const rows = await repository.readRows({
      partNumber: groupPart,
      shootingTarget: groupTarget,
      limit: 20,
      offset: 0,
    });
    expect(rows).toContainEqual(expect.objectContaining({
      source: expect.objectContaining({ itemId: safeBoundary }),
      steps: [expect.objectContaining({ step: safeBoundary })],
    }));
  });

  it('fully replaces an image step with text-only steps and releases the removed image', async () => {
    const original = asset({ name: 'text-update-original.jpeg', suffix: 'asset-text-update', digest: '7' });
    const staged = await repository.stageAssets({ assets: [original], now: baseModified });
    await repository.applyPacket({
      packet: packet({
        itemId: 905,
        modified: baseModified,
        contentHash: '5'.repeat(64),
        steps: [imageStep(1, original.imageName, original.sha256)],
      }),
      stagedAssets: staged,
    });

    const updated = await repository.applyPacket({
      packet: packet({
        itemId: 905,
        modified: new Date(baseModified.getTime() + 60_000),
        contentHash: '7'.repeat(64),
        steps: [
          { step: 1, text: 'text only one', imageName: null },
          { step: 2, text: 'text only two', imageName: null },
        ],
      }),
      stagedAssets: [],
    });

    expect(updated).toMatchObject({ outcome: 'APPLIED' });
    expect(updated.displacedAssetIds).toContain(original.assetId);
    const rows = await repository.readRows({
      partNumber: groupPart,
      shootingTarget: groupTarget,
      limit: 20,
      offset: 0,
    });
    expect(rows.find((row) => row.source.itemId === 905)?.steps).toEqual([
      expect.objectContaining({ step: 1, text: 'text only one', imageAssetId: null }),
      expect.objectContaining({ step: 2, text: 'text only two', imageAssetId: null }),
    ]);
    expect(await repository.readAsset(original.assetId)).toBeNull();
  });

  it('executes representative source-identity and grouped sorted plans with buffer accounting', async () => {
    await repository.applyPacket({
      packet: packet({
        itemId: 996,
        modified: new Date(baseModified.getTime() + 996),
        contentHash: '6'.repeat(64),
        steps: [{ step: 1, text: 'explain', imageName: null }],
      }),
      stagedAssets: [],
    });

    const sourcePlan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT "id"
      FROM "WorkInstructionRow"
      WHERE "sourceSystem" = ${sourceSystem}
        AND "sourceList" = ${'List-A'}
        AND "sourceItemId" = ${996}
    `);
    const groupPlan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT row."id", row."sourceItemId"
      FROM "WorkInstructionRow" AS row
      WHERE row."partNumber" = ${groupPart}
        AND row."shootingTarget" = ${groupTarget}
      ORDER BY row."sourceItemId" ASC,
               row."sourceList" COLLATE "C" ASC,
               row."sourceSystem" COLLATE "C" ASC
    `);
    const sourceText = sourcePlan.map((line) => line['QUERY PLAN']).join('\n');
    const groupText = groupPlan.map((line) => line['QUERY PLAN']).join('\n');
    expect(sourceText).toContain('Execution Time');
    expect(sourceText).toContain('Buffers:');
    expect(groupText).toContain('Execution Time');
    expect(groupText).toContain('Buffers:');
    console.log(`[EXPLAIN source identity]\n${sourceText}`);
    console.log(`[EXPLAIN grouped sorted]\n${groupText}`);
  });

  it('claims only old unreferenced assets and keeps active references protected', async () => {
    const old = new Date(baseModified.getTime() - 2 * 60 * 60 * 1000);
    const orphan = asset({ name: 'orphan.jpeg', suffix: 'asset-orphan', digest: 'c' });
    await repository.stageAssets({ assets: [orphan], now: old });

    const active = asset({ name: 'active.jpeg', suffix: 'asset-active', digest: 'd' });
    const stagedActive = await repository.stageAssets({ assets: [active], now: baseModified });
    await repository.applyPacket({
      packet: packet({
        itemId: 902,
        modified: baseModified,
        contentHash: 'a'.repeat(64),
        steps: [imageStep(1, active.imageName, active.sha256)],
      }),
      stagedAssets: stagedActive,
    });

    const candidates = await repository.claimCleanupCandidates({
      now: baseModified,
      limit: 50,
    });
    expect(candidates.map((candidate) => candidate.assetId)).toContain(orphan.assetId);
    expect(candidates.map((candidate) => candidate.assetId)).not.toContain(active.assetId);
    expect(await repository.readAsset(active.assetId)).toMatchObject({ status: 'ACTIVE' });
    expect(await repository.deleteAssetRecords({ assetIds: candidates.map((candidate) => candidate.assetId) })).toBeGreaterThanOrEqual(1);
    expect(await prisma.workInstructionAsset.findUnique({ where: { id: orphan.assetId } })).toBeNull();
  });

  it('keeps import outcomes monotonic and gates retry-due acknowledgement records', async () => {
    const gmailMessageId = `${messagePrefix}retry`;
    const future = new Date(baseModified.getTime() + 60 * 60 * 1000);
    await repository.recordImportMessage({ gmailMessageId, outcome: 'PENDING' });
    await repository.recordImportMessage({ gmailMessageId, outcome: 'PROCESSING', expectedOutcome: 'PENDING' });
    const applied = await repository.recordImportMessage({
      gmailMessageId,
      outcome: 'APPLIED',
      expectedOutcome: 'PROCESSING',
      nextRetryAt: future,
      mailCleanupPending: true,
    });
    expect(applied.outcome).toBe('APPLIED');
    expect(applied.mailCleanupPending).toBe(true);

    const staleFailure = await repository.recordImportMessage({
      gmailMessageId,
      outcome: 'RETRYABLE',
      expectedOutcome: 'PROCESSING',
    });
    expect(staleFailure).toMatchObject({ outcome: 'APPLIED', mailCleanupPending: true });
    expect(await repository.readImportMessages({ retryDueAt: baseModified, limit: 20, offset: 0 })).not.toContainEqual(
      expect.objectContaining({ gmailMessageId }),
    );
    expect(await repository.readImportMessages({ retryDueAt: future, limit: 20, offset: 0 })).toContainEqual(
      expect.objectContaining({ gmailMessageId }),
    );

    const acknowledged = await repository.recordImportMessage({
      gmailMessageId,
      outcome: 'APPLIED',
      mailCleanupPending: false,
      nextRetryAt: null,
    });
    expect(acknowledged).toMatchObject({ outcome: 'APPLIED', mailCleanupPending: false, nextRetryAt: null });
  });

  it('serializes two concurrent applications of the same source tuple', async () => {
    const databaseUrl = process.env.DATABASE_URL!;
    concurrentClientA = new PrismaClient({ datasourceUrl: databaseUrl });
    concurrentClientB = new PrismaClient({ datasourceUrl: databaseUrl });
    const firstRepository = new PrismaWorkInstructionRepository({ db: concurrentClientA });
    const secondRepository = new PrismaWorkInstructionRepository({ db: concurrentClientB });
    const concurrentPacket = packet({
      itemId: 999,
      modified: new Date(baseModified.getTime() + 999),
      contentHash: 'f'.repeat(64),
      steps: [{ step: 1, text: 'barrier', imageName: null }],
    });

    let waiting = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const enter = async (candidate: PrismaWorkInstructionRepository) => {
      waiting += 1;
      if (waiting === 2) release();
      await barrier;
      return candidate.applyPacket({ packet: concurrentPacket, stagedAssets: [] });
    };
    const results = await Promise.all([enter(firstRepository), enter(secondRepository)]);
    expect(results.map((result) => result.outcome).sort()).toEqual(['APPLIED', 'DUPLICATE']);
    expect(await prisma.workInstructionRow.count({
      where: { sourceSystem, sourceList: 'List-A', sourceItemId: 999 },
    })).toBe(1);
  });

  it('keeps an older concurrent revision stale after a baseline has been published', async () => {
    const baseline = packet({
      itemId: 998,
      modified: baseModified,
      contentHash: 'b'.repeat(64),
      steps: [{ step: 1, text: 'baseline', imageName: null }],
    });
    await repository.applyPacket({ packet: baseline, stagedAssets: [] });

    const newer = packet({
      itemId: 998,
      modified: new Date(baseModified.getTime() + 60_000),
      contentHash: 'n'.repeat(64),
      steps: [{ step: 1, text: 'newer', imageName: null }],
    });
    const older = packet({
      itemId: 998,
      modified: new Date(baseModified.getTime() - 60_000),
      contentHash: 'o'.repeat(64),
      steps: [{ step: 1, text: 'older', imageName: null }],
    });
    const databaseUrl = process.env.DATABASE_URL!;
    concurrentClientA = new PrismaClient({ datasourceUrl: databaseUrl });
    concurrentClientB = new PrismaClient({ datasourceUrl: databaseUrl });
    const newerRepository = new PrismaWorkInstructionRepository({ db: concurrentClientA });
    const olderRepository = new PrismaWorkInstructionRepository({ db: concurrentClientB });

    let waiting = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const enter = async (candidate: PrismaWorkInstructionRepository, candidatePacket: WorkInstructionPacket) => {
      waiting += 1;
      if (waiting === 2) release();
      await barrier;
      return candidate.applyPacket({ packet: candidatePacket, stagedAssets: [] });
    };
    const [newerResult, olderResult] = await Promise.all([
      enter(newerRepository, newer),
      enter(olderRepository, older),
    ]);
    expect(newerResult.outcome).toBe('APPLIED');
    expect(olderResult).toMatchObject({ outcome: 'STALE', rowId: newerResult.rowId, displacedAssetIds: [] });
    const finalRow = await repository.readRows({ limit: 20, offset: 0, partNumber: groupPart, shootingTarget: groupTarget });
    expect(finalRow.find((row) => row.source.itemId === 998)).toMatchObject({
      source: { modified: newer.source.modified },
      steps: [{ text: 'newer' }],
    });
  });

  it('prevents cleanup from deleting an asset while activation publishes it', async () => {
    const old = new Date(baseModified.getTime() - 2 * 60 * 60 * 1000);
    const raceAsset = asset({ name: 'race.jpeg', suffix: 'asset-race', digest: 'e' });
    const staged = await repository.stageAssets({ assets: [raceAsset], now: old });
    const racePacket = packet({
      itemId: 997,
      modified: baseModified,
      contentHash: 'r'.repeat(64),
      steps: [imageStep(1, raceAsset.imageName, raceAsset.sha256)],
    });
    const databaseUrl = process.env.DATABASE_URL!;
    concurrentClientA = new PrismaClient({ datasourceUrl: databaseUrl });
    concurrentClientB = new PrismaClient({ datasourceUrl: databaseUrl });
    const cleanupRepository = new PrismaWorkInstructionRepository({ db: concurrentClientA });
    const applyRepository = new PrismaWorkInstructionRepository({ db: concurrentClientB });
    let waiting = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const enter = async <T>(work: () => Promise<T>): Promise<T> => {
      waiting += 1;
      if (waiting === 2) release();
      await barrier;
      return work();
    };
    const [cleanupResult, applyResult] = await Promise.allSettled([
      enter(() => cleanupRepository.claimCleanupCandidates({ now: baseModified, limit: 10 })),
      enter(() => applyRepository.applyPacket({ packet: racePacket, stagedAssets: staged, now: baseModified })),
    ]);
    const raceRow = await prisma.workInstructionRow.findUnique({
      where: {
        sourceSystem_sourceList_sourceItemId: {
          sourceSystem,
          sourceList: 'List-A',
          sourceItemId: 997,
        },
      },
      include: { steps: true },
    });
    const raceAssetRecord = await prisma.workInstructionAsset.findUnique({ where: { id: raceAsset.assetId } });
    expect(raceAssetRecord).not.toBeNull();
    if (applyResult.status === 'fulfilled') {
      expect(applyResult.value.outcome).toBe('APPLIED');
      expect(raceRow?.steps).toHaveLength(1);
      expect(raceAssetRecord?.status).toBe('ACTIVE');
      if (cleanupResult.status === 'fulfilled') expect(cleanupResult.value).toHaveLength(0);
    } else {
      expect(raceRow).toBeNull();
      expect(raceAssetRecord?.status).toBe('DELETE_PENDING');
      expect(cleanupResult.status).toBe('fulfilled');
      expect(cleanupResult.value.map((candidate) => candidate.assetId)).toContain(raceAsset.assetId);
    }
  });
});
