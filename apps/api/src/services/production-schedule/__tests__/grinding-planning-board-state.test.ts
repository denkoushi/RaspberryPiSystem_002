import { Prisma } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: { version: 0, updatedAt: new Date('2026-10-01') },
  prisma: {
    $queryRaw: vi.fn(),
    productionScheduleGrindingPlanningBoardState: { findUnique: vi.fn() },
    productionScheduleGrindingPlanningBoardOverride: { aggregate: vi.fn() },
    productionScheduleResourceMaster: { aggregate: vi.fn() },
    productionScheduleSeibanMachineNameSupplement: { aggregate: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceMinutesSource: { aggregate: vi.fn() },
    productionScheduleGrindingPlanningBoardResourcePartMinutes: { aggregate: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceCapacity: { aggregate: vi.fn() }
  },
  readGrindingPlanningBoardSnapshotGenerationToken: vi.fn()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../leaderboard/leaderboard-shell-snapshot-generation.js', () => ({
  readGrindingPlanningBoardSnapshotGenerationToken: mocks.readGrindingPlanningBoardSnapshotGenerationToken
}));
vi.mock('../sessaku-pieces/piece-key.js', () => ({ readSessakuPieceGeneration: vi.fn() }));
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { readSessakuPieceGeneration } from '../sessaku-pieces/piece-key.js';
import { readPlanningLoadGenerationToken, readPlanningSnapshotGenerationDetails } from '../grinding-planning-board/state.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue(mocks.state);
  for (const table of Object.values(mocks.prisma)) {
    if ('aggregate' in table) table.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } });
  }
  mocks.prisma.$queryRaw.mockResolvedValue([{ fingerprint: 'override-resources-1' }]);
  mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('leaderboard-1');
  vi.mocked(readSessakuPieceGeneration).mockResolvedValue('pieces-1');
});

describe('load generation token', () => {
  it.each(['leaderboard', 'piece'])('changes when %s generation changes', async (input) => {
    const before = await readPlanningLoadGenerationToken('site-a');
    if (input === 'leaderboard') mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('changed');
    else vi.mocked(readSessakuPieceGeneration).mockResolvedValue('changed-pieces');
    expect(await readPlanningLoadGenerationToken('site-a')).not.toBe(before);
  });

  it.each([
    'productionScheduleGrindingPlanningBoardResourceMinutesSource',
    'productionScheduleGrindingPlanningBoardResourcePartMinutes'
  ] as const)('tracks count and timestamp independently for %s', async (table) => {
    const aggregate = mocks.prisma[table].aggregate;
    const baseline = await aggregate();
    const before = await readPlanningLoadGenerationToken('site-a');
    aggregate.mockResolvedValue({ ...baseline, _count: { _all: baseline._count._all + 1 } });
    expect(await readPlanningLoadGenerationToken('site-a')).not.toBe(before);
    aggregate.mockResolvedValue({ ...baseline, _max: { updatedAt: new Date('2026-11-01') } });
    expect(await readPlanningLoadGenerationToken('site-a')).not.toBe(before);
  });

  it.each(['rank', 'pin', 'dueDate'])('ignores %s-only override writes while the full token changes', async () => {
    const before = await readPlanningSnapshotGenerationDetails('site-a');
    mocks.prisma.productionScheduleGrindingPlanningBoardOverride.aggregate.mockResolvedValue({
      _count: { _all: 0 }, _max: { updatedAt: new Date('2026-11-01') }
    });
    const after = await readPlanningSnapshotGenerationDetails('site-a');
    expect(after.loadGenerationToken).toBe(before.loadGenerationToken);
    expect(after.generationToken).not.toBe(before.generationToken);
  });

  it('uses one scoped, ordered SQL fingerprint including null resource rows', async () => {
    await readPlanningLoadGenerationToken('site-a');
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [query] = mocks.prisma.$queryRaw.mock.calls[0] as [Prisma.Sql];
    expect(query.sql).toContain('md5(COALESCE(string_agg(');
    expect(query.sql).toContain('jsonb_build_array("itemKey", "overrideResourceCd")::text');
    expect(query.sql).toContain('ORDER BY "itemKey" COLLATE "C"');
    expect(query.sql).toContain('"csvDashboardId" = ? AND "siteKey" = ?');
    for (const prefix of ['row:', 'piece:', 'pieceops:']) expect(query.sql).toContain(`"itemKey" LIKE '${prefix}%'`);
    expect(query.values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID, 'site-a']);
    expect(query.sql).not.toMatch(/IS NOT NULL|updatedAt|alternateRank|pinned|overrideDueDate/);
    mocks.prisma.$queryRaw.mockResolvedValue([{ fingerprint: 'override-resources-2' }]);
    const after = await readPlanningSnapshotGenerationDetails('site-a');
    expect(JSON.parse(after.loadGenerationToken).overrideResourceFingerprint).toBe('override-resources-2');
  });

  it.each(['boardVersion', 'boardUpdatedAt', 'resource', 'machineName', 'capacity'])('excludes %s while retaining it in the full token', async (input) => {
    const before = await readPlanningSnapshotGenerationDetails('site-a');
    if (input === 'boardVersion' || input === 'boardUpdatedAt') {
      mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({
        ...mocks.state, ...(input === 'boardVersion' ? { version: 99 } : { updatedAt: new Date('2026-11-01') })
      });
    } else {
      const table = input === 'resource' ? mocks.prisma.productionScheduleResourceMaster
        : input === 'machineName' ? mocks.prisma.productionScheduleSeibanMachineNameSupplement
        : mocks.prisma.productionScheduleGrindingPlanningBoardResourceCapacity;
      table.aggregate.mockResolvedValue({ _count: { _all: 99 }, _max: { updatedAt: new Date('2026-11-01') } });
    }
    const after = await readPlanningSnapshotGenerationDetails('site-a');
    expect(after.loadGenerationToken).toBe(before.loadGenerationToken);
    expect(after.generationToken).not.toBe(before.generationToken);
  });
});

// Match the existing integration-test boundary: never use the default application DB.
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? '';
const databaseName = (() => {
  try { return new URL(testDatabaseUrl).pathname.slice(1).split('?')[0] ?? ''; }
  catch { return ''; }
})();
const hasDedicatedDatabase = Boolean(testDatabaseUrl) && !['borrow_return', 'postgres', 'template1'].includes(databaseName);

describe.skipIf(!hasDedicatedDatabase)('override load fingerprint SQL', () => {
  let db: Client;
  beforeAll(async () => {
    db = new Client({ connectionString: testDatabaseUrl });
    await db.connect();
    // A connection-local table shadows the real table; no application rows are touched.
    await db.query(`CREATE TEMP TABLE "ProductionScheduleGrindingPlanningBoardOverride" (
      "csvDashboardId" text, "siteKey" text, "itemKey" text, "overrideResourceCd" text,
      "alternateRank" integer, "isPinned" boolean, "overrideDueDate" timestamp, "updatedAt" timestamp
    )`);
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query('TRUNCATE "ProductionScheduleGrindingPlanningBoardOverride"');
    await db.query(`INSERT INTO "ProductionScheduleGrindingPlanningBoardOverride"
      ("csvDashboardId", "siteKey", "itemKey", "overrideResourceCd") VALUES
      ($1, 'site-a', 'row:resource', 'G-01'), ($1, 'site-a', 'piece:null', NULL),
      ($1, 'site-a', 'pieceops:resource', 'G-03'), ($1, 'other-site', 'row:other', 'G-99'),
      ('other-dashboard', 'site-a', 'row:other', 'G-99'), ($1, 'site-a', 'split:legacy', 'G-99')`,
    [PRODUCTION_SCHEDULE_DASHBOARD_ID]);
    mocks.prisma.$queryRaw.mockImplementation(async (query: Prisma.Sql) =>
      (await db.query(query.text, query.values)).rows);
  });

  it.each([
    ['rank', '"alternateRank" = 5'],
    ['pin', '"isPinned" = true'],
    ['due date', `"overrideDueDate" = '2026-12-01'`]
  ])('keeps the load generation for %s-only saves', async (_label, update) => {
    const before = await readPlanningLoadGenerationToken('site-a');
    await db.query(`UPDATE "ProductionScheduleGrindingPlanningBoardOverride" SET ${update}, "updatedAt" = now()`);
    expect(await readPlanningLoadGenerationToken('site-a')).toBe(before);
  });

  it.each([
    ['resource change', `UPDATE "ProductionScheduleGrindingPlanningBoardOverride" SET "overrideResourceCd" = 'G-02' WHERE "itemKey" = 'row:resource'`],
    ['resource release', `UPDATE "ProductionScheduleGrindingPlanningBoardOverride" SET "overrideResourceCd" = NULL WHERE "itemKey" = 'pieceops:resource'`],
    ['empty resource', `UPDATE "ProductionScheduleGrindingPlanningBoardOverride" SET "overrideResourceCd" = '' WHERE "itemKey" = 'piece:null'`],
    ['null row addition', `INSERT INTO "ProductionScheduleGrindingPlanningBoardOverride" ("csvDashboardId", "siteKey", "itemKey") VALUES ($1, 'site-a', 'row:new')`],
    ['resource row addition', `INSERT INTO "ProductionScheduleGrindingPlanningBoardOverride" ("csvDashboardId", "siteKey", "itemKey", "overrideResourceCd") VALUES ($1, 'site-a', 'piece:new', 'G-04')`],
    ['null row deletion', `DELETE FROM "ProductionScheduleGrindingPlanningBoardOverride" WHERE "itemKey" = 'piece:null'`],
    ['resource row deletion', `DELETE FROM "ProductionScheduleGrindingPlanningBoardOverride" WHERE "itemKey" = 'row:resource'`]
  ])('changes the load generation for %s', async (_label, mutation) => {
    const before = await readPlanningLoadGenerationToken('site-a');
    await db.query(mutation, mutation.includes('$1') ? [PRODUCTION_SCHEDULE_DASHBOARD_ID] : []);
    expect(await readPlanningLoadGenerationToken('site-a')).not.toBe(before);
  });

  it('ignores other scopes and retains the fingerprint after reversing physical row order', async () => {
    const before = await readPlanningLoadGenerationToken('site-a');
    await db.query(`DELETE FROM "ProductionScheduleGrindingPlanningBoardOverride"
      WHERE "siteKey" <> 'site-a' OR "csvDashboardId" <> $1 OR "itemKey" LIKE 'split:%'`, [PRODUCTION_SCHEDULE_DASHBOARD_ID]);
    await db.query(`CREATE TEMP TABLE reversed_overrides AS
      SELECT * FROM "ProductionScheduleGrindingPlanningBoardOverride" ORDER BY "itemKey" DESC`);
    await db.query('TRUNCATE "ProductionScheduleGrindingPlanningBoardOverride"');
    await db.query('INSERT INTO "ProductionScheduleGrindingPlanningBoardOverride" SELECT * FROM reversed_overrides');
    expect(await readPlanningLoadGenerationToken('site-a')).toBe(before);
  });
});
