import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

const testDatabaseUrl = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.trim() ?? '';
const databaseName = (() => {
  try {
    return new URL(testDatabaseUrl).pathname.replace(/^\//, '').split('?')[0] ?? '';
  } catch {
    return '';
  }
})();
const hasDedicatedDatabase = Boolean(testDatabaseUrl) && !['borrow_return', 'postgres', 'template1'].includes(databaseName);
const originalDatabaseUrl = process.env.DATABASE_URL;
type PrismaClient = import('@prisma/client').PrismaClient;
type Enrich = typeof import('../process-arrival.service.js').enrichRowsWithProcessArrival;
type FixtureRow = { id: string; rowData: Record<string, string> };
let dbClient: PrismaClient | undefined;
let enrich: Enrich | undefined;

if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma: dbClient } = await import('../../../lib/prisma.js'));
  ({ enrichRowsWithProcessArrival: enrich } = await import('../process-arrival.service.js'));
}
const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;
const rowIds: string[] = [];
let prefix: string;

function db(): PrismaClient {
  if (!dbClient) throw new Error('A dedicated test DATABASE_URL or TEST_DATABASE_URL is required');
  return dbClient;
}

async function createRow(processOrder: string, values: Record<string, string> = {}): Promise<FixtureRow> {
  const rowData = { FSEIBAN: prefix, FHINCD: `${prefix}-part`, FSIGENCD: '305', FKOJUN: processOrder, ProductNo: '100', ...values };
  const row = await db().csvDashboardRow.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date('2026-11-06T00:00:00Z'),
      dataHash: randomUUID(),
      rowData
    },
    select: { id: true }
  });
  rowIds.push(row.id);
  return { ...row, rowData };
}

async function complete(row: FixtureRow): Promise<void> {
  await db().productionScheduleProgress.create({
    data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: row.id, isCompleted: true }
  });
}

async function arrivals(rows: FixtureRow[]): Promise<boolean[]> {
  if (!enrich) throw new Error('A dedicated test DATABASE_URL or TEST_DATABASE_URL is required');
  return (await enrich(rows, { siteKey: prefix, locationKey: prefix, placedProductNos: new Set() })).map((row) => row.arrived);
}

describeIntegration('process arrival SQL integration', () => {
  beforeEach(async () => {
    prefix = `arrival-${randomUUID().slice(0, 8)}`;
    await db().csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: 'process-arrival-integration',
        columnDefinitions: [], templateType: 'TABLE', templateConfig: {}, ingestMode: 'DEDUP',
        dedupKeyColumns: ['FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'], enabled: true
      },
      update: {}
    });
  });

  afterEach(async () => {
    await db().productionScheduleProgress.deleteMany({ where: { csvDashboardRowId: { in: rowIds } } });
    await db().csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    rowIds.length = 0;
  });

  afterAll(async () => {
    await dbClient?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('blocks arrival for an earlier incomplete process and allows it after manual completion', async () => {
    const earlier = await createRow('10');
    const later = await createRow('30');
    expect(await arrivals([later])).toEqual([false]);
    await complete(earlier);
    expect(await arrivals([later])).toEqual([true]);
  });

  it.each(['200', ''])('isolates unassigned ProductNo %j, including an empty ProductNo', async (productNo) => {
    await createRow('10', { FSEIBAN: '********', ProductNo: '100' });
    const later = await createRow('30', { FSEIBAN: '********', ProductNo: productNo });
    expect(await arrivals([later])).toEqual([true]);
    await createRow('10', { FSEIBAN: '********', ProductNo: productNo });
    expect(await arrivals([later])).toEqual([false]);
  });

  it('ignores ProductNo for normal seibans and deduplicates their input keys', async () => {
    await createRow('10', { ProductNo: '100' });
    const later = await createRow('30', { ProductNo: '200' });
    expect(await arrivals([later, { ...later, id: 'split:test', rowData: { ...later.rowData, ProductNo: '300' } }])).toEqual([false, false]);
  });

  it('picks the preferred source id over a duplicate with a larger ProductNo', async () => {
    const preferred = await createRow('10', { ProductNo: '100' });
    await complete(preferred);
    await createRow('10', { ProductNo: '999' });
    const later = await createRow('30');
    expect(await arrivals([later])).toEqual([false]);
    expect(await arrivals([preferred, later])).toEqual([true, true]);
  });

  it('trims rowData keys, resources and process orders when matching', async () => {
    const earlier = await createRow(' 10 ', {
      FSEIBAN: ` ${prefix} `, FHINCD: ` ${prefix}-part `, FSIGENCD: ' 305 ', ProductNo: ' 100 '
    });
    const later = await createRow('30');
    expect(await arrivals([later])).toEqual([false]);
    await complete(earlier);
    expect(await arrivals([later])).toEqual([true]);
  });

  it('keeps arrival and footer winners with the part expression index present', async () => {
    const indexes = await db().$queryRaw<Array<{ indexdef: string }>>(Prisma.sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'CsvDashboardRow_csvDashboardId_btrim_fseiban_fhincd_idx'
    `);
    expect(indexes).toHaveLength(1);
    const preferred = await createRow('10', { ProductNo: '' });
    await complete(preferred);
    await createRow('10', { ProductNo: '' });
    await createRow('20', { ProductNo: '200' });
    const later = await createRow('30', { ProductNo: '' });
    expect(await arrivals([preferred, later])).toEqual([true, false]);

    const { buildLeaderboardFooterChipsByPartKeyForScheduleRows } = await import(
      '../leaderboard/leaderboard-part-footer-processes.service.js'
    );
    const chips = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
      rows: [preferred, later].map((row) => ({ ...row, seibanJoinKey: prefix })),
      siteKey: prefix, locationKey: prefix
    });
    expect(chips?.[[prefix, '', `${prefix}-part`].join('\0')]).toEqual([
      expect.objectContaining({ rowId: preferred.id, resourceCd: '305', isCompleted: true }),
      expect.objectContaining({ rowId: later.id, resourceCd: '305', isCompleted: false })
    ]);
  });

  it('preserves NULLIF join semantics for null, empty, whitespace and padded values', async () => {
    const mismatches = await db().$queryRaw<Array<{ value: string | null; key: string | null }>>(Prisma.sql`
      WITH vals(v) AS (VALUES (NULL::text), (''), (' '), ('ORDER'), (' ORDER '), ('OTHER'))
      SELECT a.v AS value, b.v AS key FROM vals a CROSS JOIN vals b
      WHERE ((NULLIF(BTRIM(a.v), '') = b.v) IS TRUE)
        IS DISTINCT FROM ((BTRIM(a.v) = b.v AND b.v <> '') IS TRUE)
    `);
    expect(mismatches).toEqual([]);
  });
});
