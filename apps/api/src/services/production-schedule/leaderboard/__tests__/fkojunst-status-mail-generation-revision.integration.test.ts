import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../../constants.js';

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
type GenerationRevision = typeof import('../../fkojunst-status-mail-generation-revision.js');

let dbClient: PrismaClient | undefined;
let generationRevision: GenerationRevision | undefined;

if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma: dbClient } = await import('../../../../lib/prisma.js'));
  generationRevision = await import('../../fkojunst-status-mail-generation-revision.js');
}

const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;

function db(): PrismaClient {
  if (!dbClient) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return dbClient;
}

function revisionReader(): GenerationRevision['fetchFkojunstStatusMailGenerationRevision'] {
  if (!generationRevision) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return generationRevision.fetchFkojunstStatusMailGenerationRevision;
}

const fixtureRows: string[] = [];
const fixtureRuns: string[] = [];

async function readRevision(): Promise<bigint> {
  const rows = await db().$queryRaw<Array<{ revision: bigint }>>(Prisma.sql`
    SELECT "revision"
    FROM "CsvDashboardRawRevision"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}
  `);
  if (rows[0]?.revision == null) throw new Error('synthetic test revision row is missing');
  return rows[0].revision;
}

async function ensureDashboard(): Promise<void> {
  await db().csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID },
    create: {
      id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      name: `synthetic-fkojunst-revision-${randomUUID()}`,
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

async function createRun(status: 'PROCESSING' | 'FAILED' | 'COMPLETED'): Promise<string> {
  const id = randomUUID();
  fixtureRuns.push(id);
  const now = new Date();
  await db().csvDashboardIngestRun.create({
    data: {
      id,
      csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      status,
      startedAt: now,
      completedAt: status === 'COMPLETED' ? now : null
    }
  });
  return id;
}

async function createRow(sourceIngestRunId?: string): Promise<string> {
  const id = randomUUID();
  fixtureRows.push(id);
  await db().csvDashboardRow.create({
    data: {
      id,
      csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      occurredAt: new Date('2026-09-12T00:00:00.000Z'),
      rowData: { synthetic: true, fixtureId: id },
      sourceIngestRunId
    }
  });
  return id;
}

afterEach(async () => {
  if (!dbClient) return;
  await db().csvDashboardRow.deleteMany({ where: { id: { in: fixtureRows.splice(0) } } });
  await db().csvDashboardIngestRun.deleteMany({ where: { id: { in: fixtureRuns.splice(0) } } });
});

afterAll(async () => {
  await dbClient?.$disconnect();
});

describeIntegration('FKOJUNST_Status raw generation revision boundaries', () => {
  it('captures publication, rollback, concurrent ingest, cleanup, truncate, and missing-row failures', async () => {
    await ensureDashboard();
    const initialRevision = await readRevision();

    const processingRunId = await createRun('PROCESSING');
    await createRow(processingRunId);
    const processingInsertRevision = await readRevision();
    expect(processingInsertRevision).toBeGreaterThan(initialRevision);

    await db().csvDashboardIngestRun.update({
      where: { id: processingRunId },
      data: { status: 'COMPLETED', completedAt: new Date() }
    });
    const publishedRevision = await readRevision();
    expect(publishedRevision).toBeGreaterThan(processingInsertRevision);

    const beforeFailedInsert = await readRevision();
    const failedRunId = await createRun('FAILED');
    await createRow(failedRunId);
    expect(await readRevision()).toBeGreaterThan(beforeFailedInsert);

    const beforeRollback = await readRevision();
    await expect(db().$transaction(async (tx) => {
      await tx.csvDashboardRow.create({
        data: {
          id: randomUUID(),
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          occurredAt: new Date('2026-09-12T00:00:00.000Z'),
          rowData: { synthetic: true, rollback: true }
        }
      });
      const insideRevision = await tx.$queryRaw<Array<{ revision: bigint }>>(Prisma.sql`
        SELECT "revision"
        FROM "CsvDashboardRawRevision"
        WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}
      `);
      expect(insideRevision[0]?.revision).toBeGreaterThan(beforeRollback);
      throw new Error('synthetic rollback');
    })).rejects.toThrow('synthetic rollback');
    expect(await readRevision()).toBe(beforeRollback);

    const concurrentRunId = await createRun('PROCESSING');
    const beforeConcurrentInsert = await readRevision();
    let releaseRawInsert!: () => void;
    let signalRawInsert!: () => void;
    const rawInsertReady = new Promise<void>((resolve) => { signalRawInsert = resolve; });
    const releaseRawInsertPromise = new Promise<void>((resolve) => { releaseRawInsert = resolve; });
    const rawInsertTransaction = db().$transaction(async (tx) => {
      await tx.csvDashboardRow.create({
        data: {
          id: randomUUID(),
          csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
          occurredAt: new Date('2026-09-12T00:00:00.000Z'),
          rowData: { synthetic: true, concurrent: true },
          sourceIngestRunId: concurrentRunId
        }
      });
      signalRawInsert();
      await releaseRawInsertPromise;
    });
    await rawInsertReady;
    const blockedPublication = db().$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '100ms'`);
      return tx.csvDashboardIngestRun.update({
        where: { id: concurrentRunId },
        data: { status: 'COMPLETED', completedAt: new Date() }
      });
    });
    const blockedPublicationError = await blockedPublication.catch((error: unknown) => error);
    try {
      expect(blockedPublicationError).toBeInstanceOf(Error);
      const errorText = blockedPublicationError instanceof Error
        ? `${(blockedPublicationError as { code?: unknown }).code ?? ''} ${blockedPublicationError.message}`
        : String(blockedPublicationError);
      expect(errorText).toMatch(/55P03|lock timeout/i);
    } finally {
      releaseRawInsert();
    }
    await rawInsertTransaction;
    await db().csvDashboardIngestRun.update({
      where: { id: concurrentRunId },
      data: { status: 'COMPLETED', completedAt: new Date() }
    });
    expect(await readRevision()).toBeGreaterThan(beforeConcurrentInsert);

    const beforeDelete = await readRevision();
    await db().csvDashboardRow.deleteMany({ where: { id: { in: fixtureRows.slice(0, 1) } } });
    expect(await readRevision()).toBeGreaterThan(beforeDelete);

    const beforeTruncate = await readRevision();
    await db().$executeRawUnsafe('TRUNCATE TABLE "CsvDashboardRow" CASCADE');
    expect(await readRevision()).toBeGreaterThan(beforeTruncate);

    const preservedRevision = await readRevision();
    await db().csvDashboardRawRevision.delete({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID }
    });
    await expect(revisionReader()(db())).rejects.toThrow('raw revision row is missing');
    await db().csvDashboardRawRevision.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        revision: preservedRevision
      }
    });
  });
});
