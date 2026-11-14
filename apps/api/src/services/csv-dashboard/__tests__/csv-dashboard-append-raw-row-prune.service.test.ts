import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ingestTuningEnvShape } from '../../../config/env/ingest-tuning.js';

const mocks = vi.hoisted(() => ({
  findDashboard: vi.fn(), findFirst: vi.fn(), query: vi.fn(), execute: vi.fn(), sleep: vi.fn(), error: vi.fn(), warn: vi.fn(),
  env: { CSV_APPEND_RAW_ROW_PRUNE_ENABLED: true },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  csvDashboard: { findUnique: mocks.findDashboard },
  csvDashboardIngestRun: { findFirst: mocks.findFirst }, $queryRaw: mocks.query, $executeRaw: mocks.execute,
} }));
vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../../lib/logger.js', () => ({ logger: { error: mocks.error, warn: mocks.warn } }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.sleep }));

import { APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS, CsvDashboardAppendRawRowPruneService } from '../csv-dashboard-append-raw-row-prune.service.js';

const [seiban, customer, rigging] = APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS;
const cutoff = new Date('2026-11-14T01:00:00Z');
const completedAt = new Date('2026-11-14T01:05:00Z');
const anchor = { id: 'anchor', startedAt: cutoff, completedAt, rowsAdded: 3 };
const service = new CsvDashboardAppendRawRowPruneService();
const sqlAt = (index: number): Prisma.Sql => mocks.query.mock.calls[index][0];
const rowsOf = (length: number) => Array.from({ length }, (_, i) => ({ id: `old-${i}` }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.CSV_APPEND_RAW_ROW_PRUNE_ENABLED = true;
  mocks.findDashboard.mockResolvedValue({ ingestMode: 'APPEND' });
  mocks.findFirst.mockImplementation(async ({ where }) => where.status === 'COMPLETED' ? anchor : null);
  mocks.query.mockResolvedValueOnce([{ count: 3n }]).mockResolvedValue([]);
  mocks.execute.mockImplementation(async (sql: Prisma.Sql) => (sql.values[0] as string[]).length);
  mocks.sleep.mockResolvedValue(undefined);
});

describe('append raw row prune candidate SQL', () => {
  it.each([seiban, customer])('selects strictly before the latest nonempty completed run: %s', async (dashboardId) => {
    await service.prune(dashboardId);
    expect(mocks.findDashboard).toHaveBeenCalledWith({ where: { id: dashboardId }, select: { ingestMode: true } });
    expect(mocks.findFirst).toHaveBeenNthCalledWith(1, {
      where: { csvDashboardId: dashboardId, status: 'COMPLETED', completedAt: { not: null }, rowsAdded: { gt: 0 } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { startedAt: true, completedAt: true, rowsAdded: true, id: true },
    });
    expect(sqlAt(0).sql).toContain('SELECT COUNT(*)');
    expect(sqlAt(0).sql).toMatch(/"createdAt" >= \? AND "createdAt" <= \?/);
    expect(sqlAt(0).values).toEqual([dashboardId, cutoff, completedAt]);
    expect(sqlAt(1).sql).toContain('"createdAt" < ?');
    expect(sqlAt(1).sql).not.toContain('ORDER BY');
    expect(sqlAt(1).values).toEqual([dashboardId, cutoff, 20000]);
  });

  it('retains the first createdAt/id (backfill replay precedence) for each equal JSONB value, including values only in old history', async () => {
    await service.prune(rigging);
    const sql = sqlAt(1).sql;
    expect(sql).toContain('PARTITION BY "rowData" ORDER BY "createdAt" ASC, "id" ASC');
    expect(sql).toMatch(/FROM "CsvDashboardRow" WHERE "csvDashboardId" = \?\s*\) AS ranked\s*WHERE rn > 1 AND "createdAt" < \?/);
    expect(sql).toMatch(/AS c LIMIT \?\s*$/);
    expect(sql).not.toContain('ORDER BY "id"');
    expect(sqlAt(1).values).toEqual([rigging, cutoff, 20000]);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('does not prune other dashboards', async () => {
    expect(await service.prune('ScawStFutekigo')).toEqual({ deletedCount: 0, hasRemaining: false, skippedReason: 'unsupported-dashboard' });
    expect(mocks.findDashboard).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('counts all candidates and retained rows without writing, even when disabled', async () => {
    mocks.env.CSV_APPEND_RAW_ROW_PRUNE_ENABLED = false;
    mocks.query.mockResolvedValueOnce([{ eligible: 25000n, total: 28000n }]);
    expect(await service.count(rigging)).toEqual({ dashboardId: rigging, eligibleCount: 25000, deleteCount: 20000, retainedCount: 8000 });
    expect(sqlAt(1).sql).toContain('COUNT(*)');
    expect(sqlAt(1).sql).not.toContain('LIMIT');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe.each(['prune', 'count'] as const)('%s safety checks', (method) => {
  async function expectSkipped(reason: string) {
    if (method === 'count') mocks.query.mockResolvedValue([{ eligible: 0n, total: 20n }]);
    const result = await service[method](customer);
    expect(result).toMatchObject({ skippedReason: reason });
    if (method === 'prune') expect(result).toEqual({ deletedCount: 0, hasRemaining: false, skippedReason: reason });
    else expect(result).toEqual({ dashboardId: customer, eligibleCount: 0, deleteCount: 0, retainedCount: 20, skippedReason: reason });
    expect(mocks.execute).not.toHaveBeenCalled();
  }

  it('skips DEDUP dashboards before querying ingest runs or candidates', async () => {
    mocks.findDashboard.mockResolvedValue({ ingestMode: 'DEDUP' });
    // No anchor validation should run, so remove its queued response.
    mocks.query.mockReset();
    await expectSkipped('not-append');
    expect(mocks.findFirst).not.toHaveBeenCalled();
    if (method === 'prune') expect(mocks.query).not.toHaveBeenCalled();
    else expect(sqlAt(0).sql).toContain('WHERE FALSE');
  });

  it('skips when no qualifying completed run exists', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.query.mockReset();
    await expectSkipped('no-anchor');
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
    if (method === 'prune') expect(mocks.query).not.toHaveBeenCalled();
  });

  it('skips and warns once when raw anchor row count differs from rowsAdded', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([{ count: 2n }]);
    await expectSkipped('anchor-row-count-mismatch');
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith({ dashboardId: customer, anchorRunId: 'anchor', rowsAdded: 3, actualCount: 2 }, expect.any(String));
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
    if (method === 'prune') expect(mocks.query).toHaveBeenCalledTimes(1);
    else expect(sqlAt(1).sql).toContain('WHERE FALSE');
  });

  it.each([
    ['earlier active run', new Date('2026-11-13T23:00:00Z'), new Date('2026-11-13T23:00:00Z')],
    ['later active run', new Date('2026-11-14T01:30:00Z'), cutoff],
    ['stale active run', new Date('2026-11-13T19:59:59Z'), cutoff],
    ['six-hour boundary', new Date('2026-11-13T20:00:00Z'), new Date('2026-11-13T20:00:00Z')],
  ])('uses the safe cutoff for %s', async (_label, processingStartedAt, expectedCutoff) => {
    vi.useFakeTimers();
    const now = new Date('2026-11-14T02:00:00Z');
    vi.setSystemTime(now);
    try {
      mocks.findFirst.mockImplementation(async ({ where }) => {
        if (where.status === 'COMPLETED') return anchor;
        // Model the database's range filter, including exclusion of stale PROCESSING runs.
        return processingStartedAt >= where.startedAt.gte && processingStartedAt <= where.startedAt.lte
          ? { startedAt: processingStartedAt } : null;
      });
      if (method === 'count') mocks.query.mockResolvedValueOnce([{ eligible: 0n, total: 3n }]);
      await service[method](customer);
      expect(mocks.findFirst).toHaveBeenNthCalledWith(2, {
        where: { csvDashboardId: customer, status: 'PROCESSING', startedAt: { gte: new Date('2026-11-13T20:00:00Z'), lte: now } },
        orderBy: { startedAt: 'asc' }, select: { startedAt: true },
      });
      expect(sqlAt(1).values).toContainEqual(expectedCutoff);
    } finally { vi.useRealTimers(); }
  });
});

describe('append raw row prune execution', () => {
  it('deletes only selected primary keys and pauses for the batch duration', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(125);
    try {
      mocks.query.mockResolvedValueOnce([{ id: 'old-1' }, { id: 'old-2' }]);
      expect(await service.prune(customer)).toEqual({ deletedCount: 2, hasRemaining: false });
      const deletion = mocks.execute.mock.calls[0][0] as Prisma.Sql;
      expect(deletion.sql).toMatch(/DELETE FROM "CsvDashboardRow" WHERE "id" = ANY\(\?::text\[\]\)/);
      expect(deletion.values).toEqual([['old-1', 'old-2']]);
      expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(25);
      expect(mocks.query).toHaveBeenCalledTimes(2);
    } finally { now.mockRestore(); }
  });

  it.each([0, 1001, 19999, 20000])('selects candidates once and deletes at most 1,000 IDs per batch (%i IDs)', async (length) => {
    const rows = rowsOf(length);
    mocks.query.mockResolvedValueOnce(rows);
    expect(await service.prune(seiban)).toEqual({ deletedCount: length, hasRemaining: length === 20000 });
    const batches = Math.ceil(length / 1000);
    expect(mocks.execute).toHaveBeenCalledTimes(batches);
    expect(mocks.sleep).toHaveBeenCalledTimes(batches);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(sqlAt(1).sql).not.toContain('ORDER BY');
    expect(sqlAt(1).values).toEqual([seiban, cutoff, 20000]);
    for (let batch = 0; batch < batches; batch++) {
      expect((mocks.execute.mock.calls[batch][0] as Prisma.Sql).values).toEqual([
        rows.slice(batch * 1000, (batch + 1) * 1000).map((row) => row.id),
      ]);
    }
  });

  it('bases hasRemaining on selected count even when concurrent pruning deletes rows first', async () => {
    mocks.query.mockResolvedValueOnce(rowsOf(20000));
    mocks.execute.mockResolvedValue(0);
    expect(await service.prune(seiban)).toEqual({ deletedCount: 0, hasRemaining: true });
    expect(mocks.execute).toHaveBeenCalledTimes(20);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('does not query or write when disabled', async () => {
    mocks.env.CSV_APPEND_RAW_ROW_PRUNE_ENABLED = false;
    expect(await service.prune(customer)).toEqual({ deletedCount: 0, hasRemaining: null });
    expect(mocks.findDashboard).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reports partial progress and logs an error without throwing on delete failure', async () => {
    mocks.query.mockResolvedValueOnce(rowsOf(1001));
    mocks.execute.mockResolvedValueOnce(1000).mockRejectedValueOnce(new Error('delete failed'));
    expect(await service.prune(rigging)).toEqual({ deletedCount: 1000, hasRemaining: null, failed: true });
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ dashboardId: rigging, deletedCount: 1000 }), expect.any(String));
  });

  it('also contains anchor lookup failures', async () => {
    mocks.findFirst.mockRejectedValue(new Error('lookup failed'));
    expect(await service.prune(customer)).toEqual({ deletedCount: 0, hasRemaining: null, failed: true });
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it('defaults the environment flag to true and accepts false', () => {
    const schema = z.object({ CSV_APPEND_RAW_ROW_PRUNE_ENABLED: ingestTuningEnvShape.CSV_APPEND_RAW_ROW_PRUNE_ENABLED });
    expect(schema.parse({}).CSV_APPEND_RAW_ROW_PRUNE_ENABLED).toBe(true);
    expect(schema.parse({ CSV_APPEND_RAW_ROW_PRUNE_ENABLED: ' false ' }).CSV_APPEND_RAW_ROW_PRUNE_ENABLED).toBe(false);
  });
});
