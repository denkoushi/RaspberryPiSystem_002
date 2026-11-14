import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ingestTuningEnvShape } from '../../../config/env/ingest-tuning.js';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), query: vi.fn(), execute: vi.fn(), sleep: vi.fn(), error: vi.fn(),
  env: { CSV_APPEND_RAW_ROW_PRUNE_ENABLED: true },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  csvDashboardIngestRun: { findFirst: mocks.findFirst }, $queryRaw: mocks.query, $executeRaw: mocks.execute,
} }));
vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../../lib/logger.js', () => ({ logger: { error: mocks.error } }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.sleep }));

import { APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS, CsvDashboardAppendRawRowPruneService } from '../csv-dashboard-append-raw-row-prune.service.js';

const [seiban, customer, rigging] = APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS;
const cutoff = new Date('2026-11-14T01:00:00Z');
const service = new CsvDashboardAppendRawRowPruneService();
const sqlAt = (index: number): Prisma.Sql => mocks.query.mock.calls[index][0];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.CSV_APPEND_RAW_ROW_PRUNE_ENABLED = true;
  mocks.findFirst.mockResolvedValue({ startedAt: cutoff });
  mocks.query.mockResolvedValue([]);
  mocks.execute.mockResolvedValue(1);
  mocks.sleep.mockResolvedValue(undefined);
});

describe('append raw row prune candidate SQL', () => {
  it.each([seiban, customer])('selects strictly before the latest nonempty completed run: %s', async (dashboardId) => {
    await service.prune(dashboardId);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { csvDashboardId: dashboardId, status: 'COMPLETED', completedAt: { not: null }, rowsAdded: { gt: 0 } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], select: { startedAt: true },
    });
    expect(sqlAt(0).sql).toContain('"createdAt" < ?');
    expect(sqlAt(0).sql).not.toContain('"createdAt" <=');
    expect(sqlAt(0).values).toEqual([dashboardId, cutoff, 1000]);
  });

  it('retains the latest createdAt/id for each equal JSONB value, including values only in old history', async () => {
    await service.prune(rigging);
    const sql = sqlAt(0).sql;
    expect(sql).toContain('PARTITION BY "rowData" ORDER BY "createdAt" DESC, "id" DESC');
    expect(sql).toMatch(/FROM "CsvDashboardRow" WHERE "csvDashboardId" = \?\s*\) AS ranked\s*WHERE rn > 1 AND "createdAt" < \?/);
    expect(sqlAt(0).values).toEqual([rigging, cutoff, 1000]);
  });

  it('does not select any rows when no qualifying completed run exists', async () => {
    mocks.findFirst.mockResolvedValue(null);
    await service.prune(customer);
    expect(sqlAt(0).sql).toContain('WHERE FALSE');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('does not prune other dashboards', async () => {
    await service.prune('ScawStFutekigo');
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(sqlAt(0).sql).toContain('WHERE FALSE');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('counts all candidates and retained rows without writing, even when disabled', async () => {
    mocks.env.CSV_APPEND_RAW_ROW_PRUNE_ENABLED = false;
    mocks.query.mockResolvedValue([{ eligible: 25000n, total: 28000n }]);
    expect(await service.count(rigging)).toEqual({ dashboardId: rigging, eligibleCount: 25000, deleteCount: 20000, retainedCount: 8000 });
    expect(sqlAt(0).sql).toContain('COUNT(*)');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe('append raw row prune execution', () => {
  it('deletes only selected primary keys and pauses for the batch duration', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(125).mockReturnValue(150);
    try {
      mocks.query.mockResolvedValueOnce([{ id: 'old-1' }, { id: 'old-2' }]).mockResolvedValue([]);
      mocks.execute.mockResolvedValue(2);
      expect(await service.prune(customer)).toEqual({ deletedCount: 2, hasRemaining: false });
      const deletion = mocks.execute.mock.calls[0][0] as Prisma.Sql;
      expect(deletion.sql).toMatch(/DELETE FROM "CsvDashboardRow" WHERE "id" = ANY\(\?::text\[\]\)/);
      expect(deletion.values).toEqual([['old-1', 'old-2']]);
      expect(mocks.sleep).toHaveBeenCalledWith(25);
      expect(mocks.findFirst).toHaveBeenCalledTimes(1);
    } finally { now.mockRestore(); }
  });

  it.each([true, false])('stops at 20,000 and reports actual remaining candidates (%s)', async (hasRemaining) => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `old-${i}` }));
    for (let batch = 0; batch < 20; batch++) mocks.query.mockResolvedValueOnce(rows);
    mocks.query.mockResolvedValueOnce(hasRemaining ? [{ id: 'more' }] : []);
    mocks.execute.mockResolvedValue(1000);
    expect(await service.prune(seiban)).toEqual({ deletedCount: 20000, hasRemaining });
    expect(mocks.execute).toHaveBeenCalledTimes(20);
    expect(mocks.sleep).toHaveBeenCalledTimes(20);
    expect(mocks.query).toHaveBeenCalledTimes(21);
    expect(sqlAt(20).sql).toContain('LIMIT 1');
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
  });

  it('bounds work even when concurrent pruning deletes selected rows first', async () => {
    mocks.query.mockResolvedValue([{ id: 'already-deleted' }]);
    mocks.execute.mockResolvedValue(0);
    expect(await service.prune(seiban)).toEqual({ deletedCount: 0, hasRemaining: true });
    expect(mocks.execute).toHaveBeenCalledTimes(20);
  });

  it('does not query or write when disabled', async () => {
    mocks.env.CSV_APPEND_RAW_ROW_PRUNE_ENABLED = false;
    expect(await service.prune(customer)).toEqual({ deletedCount: 0, hasRemaining: null });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reports partial progress and logs an error without throwing on delete failure', async () => {
    mocks.query.mockResolvedValue([{ id: 'old' }]);
    mocks.execute.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('delete failed'));
    expect(await service.prune(rigging)).toEqual({ deletedCount: 1, hasRemaining: null, failed: true });
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ dashboardId: rigging, deletedCount: 1 }), expect.any(String));
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
