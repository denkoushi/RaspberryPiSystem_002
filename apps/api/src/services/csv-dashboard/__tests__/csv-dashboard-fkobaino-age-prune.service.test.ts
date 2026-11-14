import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ingestTuningEnvShape } from '../../../config/env/ingest-tuning.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID as dashboardId } from '../../production-schedule/constants.js';
import { computeCsvDashboardDedupDiff } from '../diff/csv-dashboard-diff.js';
import { withCsvDashboardIngestLock } from '../csv-dashboard-ingest-lock.js';

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(), query: vi.fn(), execute: vi.fn(), sleep: vi.fn(), error: vi.fn(),
  env: { CSV_FKOBAINO_AGE_PRUNE_ENABLED: true },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  csvDashboard: { findUnique: mocks.dashboard }, $queryRaw: mocks.query, $executeRaw: mocks.execute,
} }));
vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../../lib/logger.js', () => ({ logger: { error: mocks.error } }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.sleep }));
import { CsvDashboardFkobainoAgePruneService, FKOBAINO_AGE_PRUNE_DAYS } from '../csv-dashboard-fkobaino-age-prune.service.js';

const service = new CsvDashboardFkobainoAgePruneService();
const now = new Date('2026-11-14T02:00:00Z');
const cutoff = new Date(now.getTime() - 90 * 86400000);
const sqlAt = (index = 0): Prisma.Sql => mocks.query.mock.calls[index][0];
const rowsOf = (length: number) => Array.from({ length }, (_, i) => ({ id: `old-${i}` }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.env.CSV_FKOBAINO_AGE_PRUNE_ENABLED = true;
  mocks.dashboard.mockResolvedValue({ ingestMode: 'DEDUP' });
  mocks.query.mockResolvedValue([]);
  mocks.execute.mockImplementation(async (sql: Prisma.Sql) => (sql.values[0] as string[]).length);
  mocks.sleep.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('FKOBAINO age prune', () => {
  it('selects only FKOBAINO rows strictly older than 90 days, excluding this run and including null source IDs', async () => {
    await service.prune('current-run');
    expect(mocks.dashboard).toHaveBeenCalledExactlyOnceWith({ where: { id: dashboardId }, select: { ingestMode: true } });
    expect(sqlAt().sql).toMatch(/"csvDashboardId" = \? AND "occurredAt" < \?/);
    expect(sqlAt().sql).toContain('"sourceIngestRunId" IS DISTINCT FROM ?::text');
    expect(sqlAt().sql).not.toContain('ORDER BY');
    expect(sqlAt().values).toEqual([dashboardId, cutoff, 'current-run', 20000]);
  });

  it.each(['APPEND', 'REPLACE', null])('does not select or delete when dashboard is not DEDUP (%s)', async (ingestMode) => {
    mocks.dashboard.mockResolvedValue(ingestMode == null ? null : { ingestMode });
    expect(await service.prune('run')).toEqual({ deletedCount: 0, hasRemaining: false, skippedReason: 'not-dedup' });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([0, 1001, 19999, 20000])('selects IDs once, caps selection at 20,000 and uses 1,000-ID batches (%i)', async (length) => {
    const rows = rowsOf(length);
    mocks.query.mockResolvedValue(rows);
    expect(await service.prune('run')).toEqual({ deletedCount: length, hasRemaining: length === 20000 });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(sqlAt().sql).toMatch(/LIMIT \?\s*$/);
    expect(sqlAt().values.at(-1)).toBe(20000);
    expect(mocks.execute).toHaveBeenCalledTimes(Math.ceil(length / 1000));
    expect(mocks.sleep).toHaveBeenCalledTimes(Math.ceil(length / 1000));
    for (let i = 0; i < mocks.execute.mock.calls.length; i++) {
      const deletion = mocks.execute.mock.calls[i][0] as Prisma.Sql;
      expect(deletion.sql).toContain('DELETE FROM "CsvDashboardRow" WHERE "id" = ANY(?::text[])');
      expect(deletion.sql).toContain('"occurredAt" < ?');
      expect(deletion.sql).toContain('"sourceIngestRunId" IS DISTINCT FROM ?::text');
      expect(deletion.values).toEqual([rows.slice(i * 1000, (i + 1) * 1000).map((row) => row.id), dashboardId, cutoff, 'run']);
    }
  });

  it('pauses for the batch duration', async () => {
    mocks.query.mockResolvedValue(rowsOf(1));
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(now.getTime()).mockReturnValueOnce(100).mockReturnValueOnce(125);
    try {
      await service.prune('run');
      expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(25);
    } finally { clock.mockRestore(); }
  });

  it('waits for an active ingest before deleting and releases the mutex before sleeping', async () => {
    let release!: () => void;
    let selected!: () => void;
    const selection = new Promise<void>((resolve) => { selected = resolve; });
    const activeIngest = withCsvDashboardIngestLock(dashboardId, () => new Promise<void>((resolve) => { release = resolve; }));
    // Allow the active ingest to acquire the mutex.
    await Promise.resolve();
    mocks.query.mockImplementationOnce(async () => { selected(); return rowsOf(1); });
    const betweenBatches = vi.fn();
    mocks.sleep.mockImplementation(async () => {
      await withCsvDashboardIngestLock(dashboardId, async () => { betweenBatches(); });
    });
    const pruning = service.prune('run');
    await selection;
    expect(mocks.execute).not.toHaveBeenCalled();
    release();
    await activeIngest;
    expect(await pruning).toEqual({ deletedCount: 1, hasRemaining: false });
    expect(betweenBatches).toHaveBeenCalledOnce();
  });

  it('contains partial delete failures and logs an error', async () => {
    mocks.query.mockResolvedValue(rowsOf(1001));
    mocks.execute.mockResolvedValueOnce(1000).mockRejectedValueOnce(new Error('delete failed'));
    expect(await service.prune('run')).toEqual({ deletedCount: 1000, hasRemaining: null, failed: true });
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ dashboardId, deletedCount: 1000, err: expect.any(Error) }), expect.any(String));
  });

  it('contains dashboard lookup failures', async () => {
    mocks.dashboard.mockRejectedValue(new Error('lookup failed'));
    expect(await service.prune('run')).toEqual({ deletedCount: 0, hasRemaining: null, failed: true });
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it('does no database work when disabled', async () => {
    mocks.env.CSV_FKOBAINO_AGE_PRUNE_ENABLED = false;
    expect(await service.prune('run')).toEqual({ deletedCount: 0, hasRemaining: null });
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('counts one execution and retained rows without deleting, even when disabled', async () => {
    mocks.env.CSV_FKOBAINO_AGE_PRUNE_ENABLED = false;
    mocks.query.mockResolvedValue([{ eligible: 25000n, total: 28000n }]);
    expect(await service.count()).toEqual({ dashboardId, eligibleCount: 25000, deleteCount: 20000, retainedCount: 8000 });
    expect(sqlAt().sql).toContain('AND TRUE');
    expect(sqlAt().sql).not.toContain('LIMIT');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('counts zero candidates for non-DEDUP dashboards', async () => {
    mocks.dashboard.mockResolvedValue({ ingestMode: 'APPEND' });
    mocks.query.mockResolvedValue([{ eligible: 0n, total: 20n }]);
    expect(await service.count()).toMatchObject({ deleteCount: 0, retainedCount: 20, skippedReason: 'not-dedup' });
    expect(sqlAt().sql).toContain('WHERE FALSE');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('keeps 90 days well beyond the unchanged-row maximum refresh of 37 days', () => {
    expect(FKOBAINO_AGE_PRUNE_DAYS).toBe(90);
    expect(FKOBAINO_AGE_PRUNE_DAYS).toBeGreaterThan(2 * 37);
    // The existing diff has no exported refresh constant. Exercise its maximum-age boundary.
    for (let i = 0; i < 100; i++) {
      const data = { FKOBAINO: `PO-${i}` };
      const result = computeCsvDashboardDedupDiff({
        dashboardId, now, completedValue: 'C',
        incomingRows: [{ data, occurredAt: now, hash: `hash-${i}` }],
        existingRows: [{ id: 'row', rowData: data, dataHash: `hash-${i}`, occurredAt: new Date(now.getTime() - 37 * 86400000) }],
        options: { skipUnchangedRowsWithinRefreshWindow: true },
      });
      expect(result.updates).toHaveLength(1);
    }
  });

  it('defaults the env flag to true and accepts false', () => {
    const schema = z.object({ CSV_FKOBAINO_AGE_PRUNE_ENABLED: ingestTuningEnvShape.CSV_FKOBAINO_AGE_PRUNE_ENABLED });
    expect(schema.parse({}).CSV_FKOBAINO_AGE_PRUNE_ENABLED).toBe(true);
    expect(schema.parse({ CSV_FKOBAINO_AGE_PRUNE_ENABLED: ' false ' }).CSV_FKOBAINO_AGE_PRUNE_ENABLED).toBe(false);
  });
});
