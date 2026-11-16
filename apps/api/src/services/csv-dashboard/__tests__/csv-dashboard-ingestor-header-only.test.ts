import { requestProductionSchedulePartNameLookupRebuild } from '../../production-schedule/production-schedule-part-name-lookup-rebuild.js';
import { Prisma } from '@prisma/client';
import { calculateProductionScheduleDataHash } from '../../production-schedule/row-resolver/index.js';
import { ProductionScheduleCleanupService } from '../../production-schedule/retention/index.js';
import { ProgressSyncFromCsvService } from '../../production-schedule/progress-sync-from-csv.service.js';
import { CsvDashboardDedupCleanupService } from '../csv-dashboard-dedup-cleanup.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, createRun, updateRun, createMany, transaction, pieceSets, createRow, findRows, executeRaw } = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  findUnique: vi.fn(),
  createRun: vi.fn(),
  updateRun: vi.fn(),
  createMany: vi.fn(),
  transaction: vi.fn(),
  createRow: vi.fn(),
  findRows: vi.fn().mockResolvedValue([]),
  pieceSets: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../production-schedule/production-schedule-part-name-lookup-rebuild.js', () => ({ requestProductionSchedulePartNameLookupRebuild: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleSessakuPieceSet: { findMany: pieceSets },
    csvDashboard: { findUnique },
    csvDashboardIngestRun: { create: createRun, update: updateRun },
    csvDashboardRow: { createMany, create: createRow, findMany: findRows },
    $transaction: transaction,
    $executeRaw: executeRaw,
  },
}));

import { CsvDashboardIngestor } from '../csv-dashboard-ingestor.js';

describe('CsvDashboardIngestor APPEND header-only CSV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeRaw.mockReset().mockResolvedValue(1);
    findUnique.mockResolvedValue({
      id: 'dashboard-1',
      name: 'Test dashboard',
      enabled: true,
      ingestMode: 'APPEND',
      dedupKeyColumns: [],
      dateColumnName: null,
      columnDefinitions: [{
        internalName: 'h1',
        displayName: 'h1',
        csvHeaderCandidates: ['h1'],
        dataType: 'string',
      }],
    });
    createRun.mockResolvedValue({ id: 'run-1', startedAt: new Date() });
    updateRun.mockResolvedValue({ id: 'run-1' });
    createMany.mockResolvedValue({ count: 0 });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ csvDashboardIngestRun: { update: updateRun } })
    );
  });

  it('completes with zero rows when the header matches', async () => {
    await expect(new CsvDashboardIngestor().ingestFromGmail('dashboard-1', 'h1\n')).resolves.toMatchObject({
      rowsProcessed: 0, rowsAdded: 0, rowsSkipped: 0,
    });
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ status: 'COMPLETED', rowsProcessed: 0 }),
    });
  });

  it('fails with CSV_HEADER_MISMATCH when the header does not match', async () => {
    await expect(new CsvDashboardIngestor().ingestFromGmail('dashboard-1', 'wrong\n')).rejects.toMatchObject({
      code: 'CSV_HEADER_MISMATCH',
    });
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });

  it('processes one data row after the header', async () => {
    await expect(new CsvDashboardIngestor().ingestFromGmail('dashboard-1', 'h1\nv1\n')).resolves.toMatchObject({
      rowsProcessed: 1, rowsAdded: 1, rowsSkipped: 0,
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ rowData: { h1: 'v1' } })],
    });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(updateRun.mock.calls.find(([args]) => args.data.status === 'COMPLETED')?.[0].data).not.toHaveProperty('rowSeenRecordedAt');
  });
  it.each([{ sets: [] }, { sets: [{ fseiban: 'SEIBAN01', fhincd: '', fsigencd: '', fkojun: '', pieces: [] }] }])('keeps production APPEND on createMany with only the legacy completion tx for %j', async ({ sets }) => {
    const dashboard = await findUnique();
    findUnique.mockResolvedValue({ ...dashboard, id: PRODUCTION_SCHEDULE_DASHBOARD_ID, columnDefinitions: ['ProductNo', 'FSEIBAN'].map((name) => ({ internalName: name, displayName: name, csvHeaderCandidates: [name], dataType: 'string' })) });
    pieceSets.mockResolvedValueOnce(sets);
    await new CsvDashboardIngestor().ingestFromGmail(PRODUCTION_SCHEDULE_DASHBOARD_ID, 'ProductNo,FSEIBAN\n0000000123,SEIBAN01\n');
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(pieceSets).toHaveBeenCalledTimes(1);
  });

  it('marks a production ingest FAILED and skips success completion and cleanup when progress sync rejects', async () => {
    const dashboard = await findUnique();
    findUnique.mockResolvedValue({ ...dashboard, id: PRODUCTION_SCHEDULE_DASHBOARD_ID, ingestMode: 'DEDUP', columnDefinitions: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN', 'progress'].map((name) => ({ internalName: name, displayName: name, csvHeaderCandidates: [name], dataType: 'string' })) });
    createRow.mockResolvedValue({ id: 'persisted-row' });
    const sync = vi.spyOn(ProgressSyncFromCsvService.prototype, 'sync').mockRejectedValueOnce(new Error('CSV progress sync failed for 1 rows'));
    const cleanup = vi.spyOn(CsvDashboardDedupCleanupService.prototype, 'deleteDuplicateLosersForKeys');
    try {
      await expect(new CsvDashboardIngestor().ingestFromGmail(PRODUCTION_SCHEDULE_DASHBOARD_ID, 'ProductNo,FSEIBAN,FHINCD,FSIGENCD,FKOJUN,progress\n0000000123,SEIBAN01,PART-A,1,1,完了\n')).rejects.toThrow('CSV progress sync failed for 1 rows');
      expect(createRow).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledWith(expect.objectContaining({ candidates: [expect.objectContaining({ rowId: 'persisted-row' })] }));
      expect(updateRun).toHaveBeenCalledExactlyOnceWith({ where: { id: 'run-1' }, data: { status: 'FAILED', errorMessage: 'CSV progress sync failed for 1 rows', completedAt: expect.any(Date) } });
      expect(transaction).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
    } finally { sync.mockRestore(); cleanup.mockRestore(); }
  });

  const productionDashboard = async (ingestMode = 'APPEND') => {
    findUnique.mockResolvedValue({ ...(await findUnique()), id: PRODUCTION_SCHEDULE_DASHBOARD_ID, ingestMode,
      columnDefinitions: ['ProductNo', 'FSEIBAN'].map((name) => ({ internalName: name, displayName: name, csvHeaderCandidates: [name], dataType: 'string' })) });
  };

  it.each([true, false])('records every CSV hash in 1000-row batches before completion (received time present=%s)', async (hasReceived) => {
    await productionDashboard();
    const startedAt = new Date('2026-11-15T04:00:00Z');
    const receivedAt = new Date('2026-11-14T03:00:00Z');
    createRun.mockResolvedValue({ id: 'run-1', startedAt, sourceReceivedAt: hasReceived ? receivedAt : null });
    const rows = Array.from({ length: 1001 }, (_, i) => ({ ProductNo: '0000000123', FSEIBAN: `ORD${String(i).padStart(5, '0')}` }));
    await new CsvDashboardIngestor().ingestFromGmail(PRODUCTION_SCHEDULE_DASHBOARD_ID,
      'ProductNo,FSEIBAN\n' + [...rows, rows[0]!].map((r) => `${r.ProductNo},${r.FSEIBAN}`).join('\n'), 'mail', undefined, undefined, hasReceived ? receivedAt : null);
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const queries = executeRaw.mock.calls.map(([q]) => q as Prisma.Sql);
    expect(queries[0]!.values).toHaveLength(2000);
    expect(queries[1]!.values).toHaveLength(2);
    expect(queries.flatMap((q) => q.values.filter((_, i) => i % 2 === 0))).toEqual(rows.map(calculateProductionScheduleDataHash));
    for (const query of queries) {
      expect(query.sql).toContain('ON CONFLICT ("dataHash") DO UPDATE');
      expect(query.sql).toContain('GREATEST("ProductionScheduleRowSeen"."lastSeenAt", EXCLUDED."lastSeenAt")');
      expect(query.values[1]).toEqual(hasReceived ? receivedAt : startedAt);
    }
    expect(executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(transaction.mock.invocationCallOrder[0]!);
    expect(updateRun).toHaveBeenCalledWith({ where: { id: 'run-1' }, data: expect.objectContaining({ status: 'COMPLETED', rowSeenRecordedAt: expect.any(Date) }) });
  });

  it('records rows before the one-year filter and maximum ProductNo selection', async () => {
    await productionDashboard('DEDUP');
    const filter = vi.spyOn(ProductionScheduleCleanupService.prototype, 'filterIncomingRowsByOneYear').mockImplementation(({ rows }) => {
      expect(executeRaw).toHaveBeenCalledTimes(1);
      return { kept: [], droppedCount: rows.length };
    });
    const cleanup = vi.spyOn(CsvDashboardDedupCleanupService.prototype, 'deleteDuplicateLosersForKeys').mockResolvedValue({ deletedCount: 0 });
    try {
      await new CsvDashboardIngestor().ingestFromGmail(PRODUCTION_SCHEDULE_DASHBOARD_ID, 'ProductNo,FSEIBAN\n0000000123,ORDER001\n0000000124,ORDER001\n');
      const query = executeRaw.mock.calls[0]![0] as Prisma.Sql;
      expect(query.values).toContain(calculateProductionScheduleDataHash({ ProductNo: '0000000123', FSEIBAN: 'ORDER001' }));
      expect(query.values).toContain(calculateProductionScheduleDataHash({ ProductNo: '0000000124', FSEIBAN: 'ORDER001' }));
    } finally { filter.mockRestore(); cleanup.mockRestore(); }
  });

  it('leaves the run unrecorded and skips completion after a later seen batch fails', async () => {
    await productionDashboard();
    executeRaw.mockResolvedValueOnce(1000).mockRejectedValueOnce(new Error('seen batch failed'));
    await expect(new CsvDashboardIngestor().ingestFromGmail(PRODUCTION_SCHEDULE_DASHBOARD_ID,
      'ProductNo,FSEIBAN\n' + Array.from({ length: 1001 }, (_, i) => `0000000123,ORD${String(i).padStart(5, '0')}`).join('\n'))).rejects.toThrow('seen batch failed');
    expect(transaction).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledExactlyOnceWith({ where: { id: 'run-1' }, data: expect.objectContaining({ status: 'FAILED' }) });
    expect(updateRun.mock.calls[0]![0].data).not.toHaveProperty('rowSeenRecordedAt');
  });

  it('returns after completion and dedup cleanup without waiting for a slow rebuild', async () => {
    await productionDashboard('DEDUP');
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(requestProductionSchedulePartNameLookupRebuild).mockReturnValueOnce(slow);
    const cleanup = vi.spyOn(CsvDashboardDedupCleanupService.prototype, 'deleteDuplicateLosersForKeys').mockResolvedValue({ deletedCount: 3 });
    try {
      const result = await new CsvDashboardIngestor().ingestFromGmail(PRODUCTION_SCHEDULE_DASHBOARD_ID, 'ProductNo,FSEIBAN\n');
      expect(result.rowsProcessed).toBe(0);
      expect(requestProductionSchedulePartNameLookupRebuild).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({ deferPartNameLookupRebuild: true }));
      expect(updateRun.mock.invocationCallOrder[0]!).toBeLessThan(cleanup.mock.invocationCallOrder[0]!);
      expect(cleanup.mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(requestProductionSchedulePartNameLookupRebuild).mock.invocationCallOrder[0]!);
    } finally { finish(); cleanup.mockRestore(); }
  });

});
