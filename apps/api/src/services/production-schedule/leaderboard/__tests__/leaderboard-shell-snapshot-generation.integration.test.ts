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

    await db().csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        name: `generation-main-${suffix}`,
        columnDefinitions: [],
        templateType: 'TABLE',
        templateConfig: {},
        ingestMode: 'APPEND',
        dedupKeyColumns: [],
        enabled: true
      },
      update: {}
    });
    await db().csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        name: `generation-mail-${suffix}`,
        columnDefinitions: [],
        templateType: 'TABLE',
        templateConfig: {},
        ingestMode: 'APPEND',
        dedupKeyColumns: [],
        enabled: true
      },
      update: {}
    });
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
    expect(firstToken.rowsCount).toBe('2');
    expect(firstToken.rowsLatestCreatedAt).toBe(mainLatestCreatedAt.toISOString());
    expect(firstToken.rowsLatestUpdatedAt).toBe(mainLatestUpdatedAt.toISOString());
    expect(first.fkojunstStatusMailRowsRevision).toBe(
      ['2', completedMailCreatedAt.toISOString(), completedMailUpdatedAt.toISOString()].join(':')
    );

    await db().csvDashboardIngestRun.update({
      where: { id: pendingRunId },
      data: { status: 'COMPLETED', completedAt: new Date('2026-09-10T00:08:00.000Z') }
    });

    const afterCompletedRun = await readGeneration()();
    const afterToken = JSON.parse(afterCompletedRun.generationToken) as Record<string, string>;

    expect(afterCompletedRun.generationToken).not.toBe(first.generationToken);
    expect(afterToken.rowsCount).toBe('2');
    expect(afterCompletedRun.fkojunstStatusMailRowsRevision).toBe(
      ['3', pendingMailCreatedAt.toISOString(), pendingMailUpdatedAt.toISOString()].join(':')
    );
    const jitAfter = await db().$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT current_setting('jit') AS value`);
    expect(jitAfter[0]?.value).toBe(jitBefore[0]?.value);
  });
});
