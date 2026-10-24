import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeRawMock, queryRawMock, transactionMock, setTimeoutMock } = vi.hoisted(() => ({
  executeRawMock: vi.fn(), queryRawMock: vi.fn(), transactionMock: vi.fn(), setTimeoutMock: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { $executeRaw: executeRawMock, $transaction: transactionMock },
}));

import { CsvDashboardDedupCleanupService } from '../csv-dashboard-dedup-cleanup.service.js';

const baseParams = {
  csvDashboardId: 'dashboard-1',
  keyColumns: ['equipmentManagementNumber', 'inspectionItem'],
  keys: [{ equipmentManagementNumber: 'M-1', inspectionItem: '油量' }],
  winnerOrder: [],
};

const executedSql = (): Prisma.Sql[] => executeRawMock.mock.calls.map((call) => call[0] as Prisma.Sql);

describe('CsvDashboardDedupCleanupService.deleteDuplicateLosersForKeys', () => {
  beforeEach(() => {
    executeRawMock.mockReset();
  });

  it('dataHashes 未指定ならキー一致だけで候補を決める（従来どおり）', async () => {
    executeRawMock.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

    const result = await new CsvDashboardDedupCleanupService().deleteDuplicateLosersForKeys(baseParams);

    expect(result).toEqual({ deletedCount: 2 });
    expect(executeRawMock).toHaveBeenCalledTimes(2);
    expect(executedSql()[0]?.sql).not.toContain('"dataHash"');
  });

  it('dataHashes 指定時は dataHash の index で候補を絞り、重複ハッシュは除いて1つの配列で渡す', async () => {
    executeRawMock.mockResolvedValueOnce(0);

    await new CsvDashboardDedupCleanupService().deleteDuplicateLosersForKeys({
      ...baseParams,
      dataHashes: ['h1', 'h2', 'h1', ''],
    });

    const sql = executedSql()[0];
    expect(sql?.sql).toContain('r."dataHash" = ANY(');
    expect(sql?.values).toContainEqual(['h1', 'h2']);
  });

  it('dataHashes が空ならDBへ問い合わせない', async () => {
    const result = await new CsvDashboardDedupCleanupService().deleteDuplicateLosersForKeys({
      ...baseParams,
      dataHashes: [],
    });

    expect(result).toEqual({ deletedCount: 0 });
    expect(executeRawMock).not.toHaveBeenCalled();
  });
});


describe('CsvDashboardDedupCleanupService.deleteDuplicateLosersGlobally', () => {
  const service = new CsvDashboardDedupCleanupService();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T17:40:00Z'));
    transactionMock.mockImplementation(async (callback) => callback({
      $queryRaw: queryRawMock, $executeRaw: setTimeoutMock,
    }));
  });
  afterEach(() => vi.useRealTimers());

  it('one ranking scan supplies multiple PK delete chunks, then an empty scan completes', async () => {
    const rows = Array.from({ length: 10001 }, (_, i) => ({ id: `loser-${i}` }));
    queryRawMock.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    executeRawMock.mockResolvedValueOnce(5000).mockResolvedValueOnce(5000).mockResolvedValueOnce(0);

    const result = await service.deleteDuplicateLosersGlobally(baseParams);

    expect(result).toEqual({ deletedCount: 10000, stoppedReason: 'completed', scans: 2 });
    expect(queryRawMock).toHaveBeenCalledTimes(2);
    expect(executeRawMock).toHaveBeenCalledTimes(3);
    expect(executedSql().map((sql) => sql.values[0])).toEqual([
      rows.slice(0, 5000).map((row) => row.id),
      rows.slice(5000, 10000).map((row) => row.id),
      ['loser-10000'],
    ]);
    for (const sql of executedSql()) {
      expect(sql.sql).toContain('WHERE "id" = ANY(?::text[])');
      expect(sql.sql).not.toContain('ROW_NUMBER');
    }
    expect(queryRawMock.mock.invocationCallOrder[0]).toBeLessThan(executeRawMock.mock.invocationCallOrder[0]);
    expect(queryRawMock.mock.invocationCallOrder[1]).toBeGreaterThan(executeRawMock.mock.invocationCallOrder[2]);
    const scan = queryRawMock.mock.calls[0][0] as Prisma.Sql;
    expect(scan.sql).toContain("PARTITION BY r.\"csvDashboardId\", COALESCE(r.\"rowData\"->>'equipmentManagementNumber', ''), COALESCE(r.\"rowData\"->>'inspectionItem', '')");
    expect(scan.sql).toContain('ORDER BY r."createdAt" DESC, r."id" DESC');
    expect(scan.sql).toContain('SELECT "id" FROM ranked WHERE rn > 1 LIMIT ?');
    expect(scan.values).toEqual(['dashboard-1', 200000]);
    expect(setTimeoutMock.mock.calls[0][0].sql).toBe('SET LOCAL statement_timeout = 1800000');
    expect(transactionMock.mock.calls[0][1]).toEqual({ timeout: 1805000 });
  });

  it('empty first scan completes without deleting', async () => {
    queryRawMock.mockResolvedValueOnce([]);
    expect(await service.deleteDuplicateLosersGlobally(baseParams)).toEqual({
      deletedCount: 0, stoppedReason: 'completed', scans: 1,
    });
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('maxDeletedCount trims the final chunk using actual deletions and stops without another pause or scan', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: String(i) }));
    queryRawMock.mockResolvedValueOnce(rows);
    executeRawMock.mockResolvedValueOnce(80).mockResolvedValueOnce(70);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await new CsvDashboardDedupCleanupService(sleep).deleteDuplicateLosersGlobally({
      ...baseParams, deleteBatchSize: 100, maxDeletedCount: 150, minPauseMs: 500,
    });
    expect(result).toEqual({ deletedCount: 150, stoppedReason: 'max_deleted', scans: 1 });
    expect(executedSql().map((sql) => sql.values[0])).toEqual([
      rows.slice(0, 100).map((row) => row.id), rows.slice(100, 170).map((row) => row.id),
    ]);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls).toEqual([[500], [500]]);
  });

  it('a zero deletion budget stops before scanning', async () => {
    expect(await service.deleteDuplicateLosersGlobally({ ...baseParams, maxDeletedCount: 0 })).toEqual({
      deletedCount: 0, stoppedReason: 'max_deleted', scans: 0,
    });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('pauses after the scan and between chunks using elapsed time and a minimum, but not after the last chunk', async () => {
    queryRawMock.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 700);
      return Array.from({ length: 201 }, (_, i) => ({ id: String(i) }));
    });
    for (const elapsedMs of [100, 400, 600]) {
      executeRawMock.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + elapsedMs);
        return 1;
      });
    }
    const sleep = vi.fn(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
    expect(await new CsvDashboardDedupCleanupService(sleep).deleteDuplicateLosersGlobally({
      ...baseParams, deleteBatchSize: 100, maxScans: 1, pauseRatio: 2, minPauseMs: 500,
    })).toEqual({ deletedCount: 3, stoppedReason: 'max_scans', scans: 1 });
    expect(sleep.mock.calls).toEqual([[1400], [500], [800]]);
    expect(sleep.mock.invocationCallOrder[0]).toBeLessThan(executeRawMock.mock.invocationCallOrder[0]);
    expect(sleep.mock.invocationCallOrder[1]).toBeGreaterThan(executeRawMock.mock.invocationCallOrder[0]);
    expect(sleep.mock.invocationCallOrder[1]).toBeLessThan(executeRawMock.mock.invocationCallOrder[1]);
    expect(sleep.mock.invocationCallOrder[2]).toBeGreaterThan(executeRawMock.mock.invocationCallOrder[1]);
    expect(sleep.mock.invocationCallOrder[2]).toBeLessThan(executeRawMock.mock.invocationCallOrder[2]);
  });

  it('caps pauses at 30 seconds and pauses before a subsequent scan, but not after an empty scan', async () => {
    queryRawMock.mockResolvedValueOnce([{ id: 'loser' }]).mockResolvedValueOnce([]);
    executeRawMock.mockResolvedValueOnce(1);
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await new CsvDashboardDedupCleanupService(sleep).deleteDuplicateLosersGlobally({
      ...baseParams, minPauseMs: 60000,
    })).toEqual({ deletedCount: 1, stoppedReason: 'completed', scans: 2 });
    expect(sleep.mock.calls).toEqual([[30000], [30000]]);
    expect(sleep.mock.invocationCallOrder[1]).toBeLessThan(queryRawMock.mock.invocationCallOrder[1]);
  });

  it.each(['scan', 'delete'])('the pause after a %s is shortened to the deadline and stops further work', async (stage) => {
    const deadline = new Date(Date.now() + (stage === 'scan' ? 300 : 800));
    queryRawMock.mockResolvedValueOnce(Array.from({ length: 201 }, (_, i) => ({ id: String(i) })));
    executeRawMock.mockResolvedValue(100);
    const sleep = vi.fn(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
    expect(await new CsvDashboardDedupCleanupService(sleep).deleteDuplicateLosersGlobally({
      ...baseParams, deleteBatchSize: 100, deadline, minPauseMs: 500,
    })).toEqual({ deletedCount: stage === 'scan' ? 0 : 100, stoppedReason: 'deadline', scans: 1 });
    expect(sleep.mock.calls).toEqual(stage === 'scan' ? [[300]] : [[500], [300]]);
    expect(Date.now()).toBe(deadline.getTime());
    expect(executeRawMock).toHaveBeenCalledTimes(stage === 'scan' ? 0 : 1);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it('past deadline stops without querying', async () => {
    expect(await service.deleteDuplicateLosersGlobally({ ...baseParams, deadline: new Date(Date.now() - 1) })).toEqual({
      deletedCount: 0, stoppedReason: 'deadline', scans: 0,
    });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('deadline stops between chunks and limits the scan statement timeout', async () => {
    const deadline = new Date(Date.now() + 60000);
    queryRawMock.mockResolvedValueOnce(Array.from({ length: 201 }, (_, i) => ({ id: String(i) })));
    executeRawMock.mockImplementationOnce(async () => { vi.setSystemTime(deadline); return 100; });
    expect(await service.deleteDuplicateLosersGlobally({ ...baseParams, deadline, deleteBatchSize: 100 })).toEqual({
      deletedCount: 100, stoppedReason: 'deadline', scans: 1,
    });
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    expect(setTimeoutMock.mock.calls[0][0].sql).toBe('SET LOCAL statement_timeout = 60000');
    expect(transactionMock.mock.calls[0][1]).toEqual({ timeout: 65000 });
  });

  it('maxScans bounds ranking scans and retains custom winner order', async () => {
    queryRawMock.mockResolvedValueOnce([{ id: 'loser' }]);
    executeRawMock.mockResolvedValueOnce(1);
    expect(await service.deleteDuplicateLosersGlobally({
      ...baseParams, maxScans: 1, scanLimit: 1000,
      winnerOrder: [{ expression: Prisma.sql`r."id"`, direction: 'ASC' }],
    })).toEqual({ deletedCount: 1, stoppedReason: 'max_scans', scans: 1 });
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(queryRawMock.mock.calls[0][0].sql).toContain('ORDER BY r."id" ASC');
    expect(queryRawMock.mock.calls[0][0].values).toEqual(['dashboard-1', 1000]);
  });

  it.each([
    new Error('Raw query failed. Code: 57014'),
    new Error('canceling statement due to statement timeout'),
    { code: '57014' },
    { code: 'P2010', meta: { code: '57014' } },
  ])('statement timeout stops gracefully: %s', async (error) => {
    queryRawMock.mockRejectedValueOnce(error);
    expect(await service.deleteDuplicateLosersGlobally(baseParams)).toEqual({
      deletedCount: 0, stoppedReason: 'statement_timeout', scans: 1,
    });
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('other errors propagate', async () => {
    const error = new Error('connection lost');
    queryRawMock.mockRejectedValueOnce(error);
    await expect(service.deleteDuplicateLosersGlobally(baseParams)).rejects.toBe(error);
  });

  it('unsafe key columns are rejected before querying', async () => {
    await expect(service.deleteDuplicateLosersGlobally({ ...baseParams, keyColumns: ["invalid'key"] }))
      .rejects.toThrow('Invalid rowData key column');
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
