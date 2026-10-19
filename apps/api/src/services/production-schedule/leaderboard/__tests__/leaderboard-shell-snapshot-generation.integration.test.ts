import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../../constants.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? '';
const databaseName = (() => {
  try {
    return new URL(testDatabaseUrl).pathname.replace(/^\//, '').split('?')[0] ?? '';
  } catch {
    return '';
  }
})();
const hasDedicatedDatabase = Boolean(testDatabaseUrl) && !['borrow_return', 'postgres', 'template1'].includes(databaseName);

type PrismaClient = import('@prisma/client').PrismaClient;
type Generation = typeof import('../leaderboard-shell-snapshot-generation.js');

let dbClient: PrismaClient | undefined;
let generation: Generation | undefined;

if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma: dbClient } = await import('../../../../lib/prisma.js'));
  generation = await import('../leaderboard-shell-snapshot-generation.js');
}

const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;

function db(): PrismaClient {
  if (!dbClient) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return dbClient;
}

function readGeneration(): Generation['readLeaderboardShellSnapshotGenerationTokenDetails'] {
  if (!generation) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return generation.readLeaderboardShellSnapshotGenerationTokenDetails;
}

async function readPersistedMainRevision(): Promise<bigint> {
  const rows = await db().$queryRaw<Array<{ revision: bigint }>>(Prisma.sql`
    SELECT "revision" FROM "CsvDashboardRawRevision"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  `);
  if (rows[0]?.revision == null) throw new Error('synthetic main revision row is missing');
  return rows[0].revision;
}

async function ensureDashboard(id: string): Promise<void> {
  await db().csvDashboard.upsert({
    where: { id },
    create: {
      id,
      name: `generation-${randomUUID()}`,
      columnDefinitions: [],
      templateType: 'TABLE',
      templateConfig: {},
      ingestMode: 'APPEND',
      dedupKeyColumns: [],
      enabled: true
    },
    update: {}
  });
}

async function readPersistedMailRevision(): Promise<string> {
  const rows = await db().$queryRaw<Array<{ revision: bigint }>>(
    Prisma.sql`SELECT "revision" FROM "CsvDashboardRawRevision" WHERE "csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'`
  );
  return String(rows[0]?.revision);
}

const fixtures: Array<{ rowIds: string[]; ingestRunIds: string[] }> = [];

afterEach(async () => {
  const fixture = fixtures.pop();
  if (!fixture || !dbClient) return;
  await db().csvDashboardRow.deleteMany({ where: { id: { in: fixture.rowIds } } });
  await db().csvDashboardIngestRun.deleteMany({ where: { id: { in: fixture.ingestRunIds } } });
});

afterAll(async () => {
  await dbClient?.$disconnect();
});

describeIntegration('leaderboard shell snapshot generation against dedicated PostgreSQL', () => {
  it('invalidates a supplement-only deletion while the latest updatedAt stays unchanged', async () => {
    await ensureDashboard(PRODUCTION_SCHEDULE_DASHBOARD_ID);
    const rowIds = [randomUUID(), randomUUID()];
    const supplementIds = [randomUUID(), randomUUID()];
    fixtures.push({ rowIds, ingestRunIds: [] });
    await db().csvDashboardRow.createMany({
      data: rowIds.map((id) => ({
        id,
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date('2026-10-09T00:00:00.000Z'),
        rowData: { synthetic: true }
      }))
    });
    await db().productionScheduleOrderSupplement.createMany({
      data: rowIds.map((csvDashboardRowId, index) => ({
        id: supplementIds[index],
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        productNo: supplementIds[index].slice(0, 20),
        resourceCd: '305',
        processOrder: '1',
        plannedQuantity: 10,
        updatedAt: new Date(`2026-10-09T00:0${index}:00.000Z`)
      }))
    });
    const before = await readGeneration()();

    await db().productionScheduleOrderSupplement.delete({ where: { id: supplementIds[0] } });
    const after = await readGeneration()();
    const beforeToken = JSON.parse(before.generationToken) as Record<string, string>;
    const afterToken = JSON.parse(after.generationToken) as Record<string, string>;

    expect(afterToken).toEqual({
      ...beforeToken,
      orderSupplementCount: String(BigInt(beforeToken.orderSupplementCount) - 1n)
    });
    expect(afterToken.orderSupplementUpdatedAt).toBe(beforeToken.orderSupplementUpdatedAt);
    expect(after.generationToken).not.toBe(before.generationToken);
  });

  it('invalidates main row writes, ignores other dashboards and ingest runs, and recreates a missing revision', async () => {
    await ensureDashboard(PRODUCTION_SCHEDULE_DASHBOARD_ID);
    const otherDashboardId = randomUUID();
    await ensureDashboard(otherDashboardId);
    const mainRowId = randomUUID();
    const otherRowId = randomUUID();
    const runId = randomUUID();
    fixtures.push({ rowIds: [mainRowId, otherRowId], ingestRunIds: [runId] });
    const createdAt = new Date('2026-10-09T00:00:00.000Z');
    const initialRevision = await readPersistedMainRevision();
    const before = await readGeneration()();

    try {
      await db().csvDashboardRow.create({
        data: {
          id: mainRowId,
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: createdAt,
          createdAt,
          updatedAt: null,
          rowData: { synthetic: true }
        }
      });
      const afterInsert = await readGeneration()();
      expect(await readPersistedMainRevision()).toBe(initialRevision + 1n);
      expect(afterInsert.generationToken).not.toBe(before.generationToken);

      await db().csvDashboardRow.update({
        where: { id: mainRowId },
        data: { rowData: { synthetic: true, changed: true }, updatedAt: null }
      });
      const afterUpdate = await readGeneration()();
      expect(await readPersistedMainRevision()).toBe(initialRevision + 2n);
      expect(afterUpdate.generationToken).not.toBe(afterInsert.generationToken);

      await db().csvDashboardRow.delete({ where: { id: mainRowId } });
      const afterDelete = await readGeneration()();
      expect(await readPersistedMainRevision()).toBe(initialRevision + 3n);
      expect(afterDelete.generationToken).not.toBe(afterUpdate.generationToken);

      await db().csvDashboardRow.create({
        data: { id: otherRowId, csvDashboardId: otherDashboardId, occurredAt: createdAt, rowData: {} }
      });
      expect(await readPersistedMainRevision()).toBe(initialRevision + 3n);
      await db().csvDashboardRow.update({ where: { id: otherRowId }, data: { rowData: { changed: true } } });
      expect(await readPersistedMainRevision()).toBe(initialRevision + 3n);
      await db().csvDashboardRow.delete({ where: { id: otherRowId } });
      expect(await readPersistedMainRevision()).toBe(initialRevision + 3n);
      await db().csvDashboardIngestRun.create({
        data: { id: runId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, status: 'COMPLETED', completedAt: createdAt }
      });
      expect((await readGeneration()()).generationToken).toBe(afterDelete.generationToken);

      await db().csvDashboardRawRevision.delete({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
      try {
        await expect(readGeneration()()).rejects.toThrow('raw revision row is missing');
        await db().csvDashboardRow.create({
          data: { id: mainRowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: createdAt, rowData: {} }
        });
        expect(await readPersistedMainRevision()).toBe(1n);
        expect(JSON.parse((await readGeneration()()).generationToken).rowsRevision).toBe('1');
      } finally {
        await db().csvDashboardRawRevision.upsert({
          where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
          create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, revision: initialRevision + 4n },
          update: { revision: initialRevision + 4n }
        });
      }
    } finally {
      await db().csvDashboard.delete({ where: { id: otherDashboardId } });
    }
  });

  it('keeps main/mail token semantics across legacy, null, and ingest-run rows', async () => {
    const jitBefore = await db().$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT current_setting('jit') AS value`);
    const suffix = randomUUID();
    const completedRunId = randomUUID();
    const pendingRunId = randomUUID();
    const mainNullUpdatedAtId = randomUUID();
    const mainUpdatedAtId = randomUUID();
    const legacyMailRowId = randomUUID();
    const completedMailRowId = randomUUID();
    const pendingMailRowId = randomUUID();
    const mainCreatedAt = new Date('2026-09-10T00:00:00.000Z');
    const mainLatestCreatedAt = new Date('2026-09-10T00:01:00.000Z');
    const mainLatestUpdatedAt = new Date('2026-09-10T00:02:00.000Z');
    const legacyMailCreatedAt = new Date('2026-09-10T00:03:00.000Z');
    const completedMailCreatedAt = new Date('2026-09-10T00:04:00.000Z');
    const completedMailUpdatedAt = new Date('2026-09-10T00:05:00.000Z');
    const pendingMailCreatedAt = new Date('2026-09-10T00:06:00.000Z');
    const pendingMailUpdatedAt = new Date('2026-09-10T00:07:00.000Z');

    fixtures.push({
      rowIds: [mainNullUpdatedAtId, mainUpdatedAtId, legacyMailRowId, completedMailRowId, pendingMailRowId],
      ingestRunIds: [completedRunId, pendingRunId]
    });

    await ensureDashboard(PRODUCTION_SCHEDULE_DASHBOARD_ID);
    await ensureDashboard(PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID);
    await db().csvDashboardIngestRun.createMany({
      data: [
        {
          id: completedRunId,
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          status: 'COMPLETED',
          startedAt: completedMailCreatedAt,
          completedAt: new Date('2026-09-10T00:04:30.000Z')
        },
        {
          id: pendingRunId,
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          status: 'PENDING',
          startedAt: pendingMailCreatedAt,
          completedAt: null
        }
      ]
    });
    await db().csvDashboardRow.createMany({
      data: [
        {
          id: mainNullUpdatedAtId,
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: mainCreatedAt,
          rowData: { FSEIBAN: `${suffix}-MAIN-NULL` },
          createdAt: mainCreatedAt,
          updatedAt: null
        },
        {
          id: mainUpdatedAtId,
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: mainLatestCreatedAt,
          rowData: { FSEIBAN: `${suffix}-MAIN-UPDATED` },
          createdAt: mainLatestCreatedAt,
          updatedAt: mainLatestUpdatedAt
        },
        {
          id: legacyMailRowId,
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          occurredAt: legacyMailCreatedAt,
          rowData: { FSEIBAN: `${suffix}-MAIL-LEGACY` },
          createdAt: legacyMailCreatedAt,
          updatedAt: null,
          sourceIngestRunId: null
        },
        {
          id: completedMailRowId,
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          occurredAt: completedMailCreatedAt,
          rowData: { FSEIBAN: `${suffix}-MAIL-COMPLETED` },
          createdAt: completedMailCreatedAt,
          updatedAt: completedMailUpdatedAt,
          sourceIngestRunId: completedRunId
        },
        {
          id: pendingMailRowId,
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          occurredAt: pendingMailCreatedAt,
          rowData: { FSEIBAN: `${suffix}-MAIL-PENDING` },
          createdAt: pendingMailCreatedAt,
          updatedAt: pendingMailUpdatedAt,
          sourceIngestRunId: pendingRunId
        }
      ]
    });

    const first = await readGeneration()();
    const same = await readGeneration()();
    const firstToken = JSON.parse(first.generationToken) as Record<string, string>;

    expect(same.generationToken).toBe(first.generationToken);
    expect(firstToken.rowsRevision).toBe(String(await readPersistedMainRevision()));
    expect(firstToken).not.toHaveProperty('rowsCount');
    expect(firstToken).not.toHaveProperty('rowsLatestCreatedAt');
    expect(firstToken).not.toHaveProperty('rowsLatestUpdatedAt');
    expect(first.fkojunstStatusMailRowsRevision).toBe(await readPersistedMailRevision());

    await db().csvDashboardIngestRun.update({
      where: { id: pendingRunId },
      data: { status: 'COMPLETED', completedAt: new Date('2026-09-10T00:08:00.000Z') }
    });

    const afterCompletedRun = await readGeneration()();
    const afterToken = JSON.parse(afterCompletedRun.generationToken) as Record<string, string>;

    expect(afterCompletedRun.generationToken).not.toBe(first.generationToken);
    expect(afterToken.rowsRevision).toBe(firstToken.rowsRevision);
    expect(afterCompletedRun.fkojunstStatusMailRowsRevision).toBe(await readPersistedMailRevision());
    expect(afterCompletedRun.fkojunstStatusMailRowsRevision).not.toBe(first.fkojunstStatusMailRowsRevision);
    const jitAfter = await db().$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT current_setting('jit') AS value`);
    expect(jitAfter[0]?.value).toBe(jitBefore[0]?.value);
  });
});
