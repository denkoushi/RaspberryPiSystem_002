import * as pipeline from '../../fkojunst-status-mail-sync.pipeline.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../../lib/logger.js';
import type { FkojunstMailNormalizedRow } from '../../fkojunst-status-mail-sync.pipeline.js';
import * as repo from '../fkojunst-external-completion-sync.repository.js';
import { FkojunstExternalCompletionSyncService } from '../fkojunst-external-completion-sync.service.js';

vi.mock('../fkojunst-external-completion-sync.repository.js', () => ({
  replaceAllWinnerExternalCompletionStatesFromMailSync: vi.fn(),
}));

function mockRow(
  partial: Partial<FkojunstMailNormalizedRow> & Pick<FkojunstMailNormalizedRow, 'fkojun' | 'fkoteicd' | 'fsezono'>
): FkojunstMailNormalizedRow {
  return {
    sourceRowId: partial.sourceRowId ?? 'src',
    fkojun: partial.fkojun,
    fkoteicd: partial.fkoteicd,
    fsezono: partial.fsezono,
    statusCode: partial.statusCode ?? 'S',
    sourceUpdatedAt: partial.sourceUpdatedAt ?? new Date('2026-05-02T00:00:00.000Z'),
    hasUnparseableDate: partial.hasUnparseableDate ?? false,
  };
}

function mockReconcileService() {
  return {
    reconcileStaleAssignments: vi.fn().mockResolvedValue({ scanned: 0, released: 0 }),
  };
}

describe('FkojunstExternalCompletionSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  it('dedupe 後 CSV が無い相当（配列空）なら同期しない', async () => {
    const prismaMock = { $transaction: vi.fn() };
    const svc = new FkojunstExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.syncFromDedupedStatusMailRows([]);

    expect(r).toEqual({ skipped: true, reason: 'empty_status_csv' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).not.toHaveBeenCalled();
  });

  it('dedupe 後に行があれば transaction 内で全 winner の外部完了を再計算する', async () => {
    let txArg: unknown;
    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        txArg = { mockTx: true, $executeRaw: vi.fn() };
        await fn(txArg);
      }),
    };

    vi.mocked(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).mockResolvedValue(undefined);

    const svc = new FkojunstExternalCompletionSyncService({
      prismaClient: prismaMock as never,
      orderAssignmentReconciliationService: mockReconcileService() as never,
    });

    const rows = [
      mockRow({ fkojun: '10', fkoteicd: 'R01', fsezono: '0001', sourceRowId: 'a' }),
      mockRow({ fkojun: '10', fkoteicd: 'R01', fsezono: '0001', sourceRowId: 'b' }),
    ];

    const r = await svc.syncFromDedupedStatusMailRows(rows);

    expect(r).toEqual({ skipped: false });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).toHaveBeenCalledTimes(1);
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).toHaveBeenCalledWith(txArg);
  });
  it.each([false, true])('refreshes missing-hours candidates after schedule ingest (process now present=%s)', async (present) => {
    const mail = mockRow({ fsezono: '0004091808', fkojun: '710', fkoteicd: '587', statusCode: 'R' });
    vi.spyOn(pipeline, 'loadFkojunstMailSourceRows').mockResolvedValue({ scanned: 1, normalizedRows: [mail],
      skippedInvalidStatus: 0, skippedUnparseableDate: 0, rowsRevision: '42' });
    const donor = { id: 'new-donor', ProductNo: '0004091808', FKOJUN: present ? '710' : '200', FSIGENCD: '587' };
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValueOnce([{ revision: 42n }]).mockResolvedValueOnce([donor]),
      productionScheduleMissingStandardHoursProcess: { deleteMany: vi.fn(), createMany: vi.fn() } };
    const client = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    const service = new FkojunstExternalCompletionSyncService({ prismaClient: client as never,
      orderAssignmentReconciliationService: mockReconcileService() as never });
    await service.syncFromCurrentStatusMailDashboard();
    expect(tx.productionScheduleMissingStandardHoursProcess.deleteMany).toHaveBeenCalledTimes(1);
    if (present) expect(tx.productionScheduleMissingStandardHoursProcess.createMany).not.toHaveBeenCalled();
    else expect(tx.productionScheduleMissingStandardHoursProcess.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ csvDashboardRowId: 'new-donor', fkojun: '710' })] });
  });

  it('does not replace candidates when the retained mail source changed before schedule refresh', async () => {
    vi.spyOn(pipeline, 'loadFkojunstMailSourceRows').mockResolvedValue({ scanned: 1, normalizedRows: [mockRow({ fsezono: '1', fkojun: '710', fkoteicd: '587' })],
      skippedInvalidStatus: 0, skippedUnparseableDate: 0, rowsRevision: '42' });
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([{ revision: 43n }]),
      productionScheduleMissingStandardHoursProcess: { deleteMany: vi.fn() } };
    const client = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    const reconcile = mockReconcileService();
    const service = new FkojunstExternalCompletionSyncService({ prismaClient: client as never,
      orderAssignmentReconciliationService: reconcile as never });
    await expect(service.syncFromCurrentStatusMailDashboard()).resolves.toEqual({ skipped: false });
    expect(logger.warn).toHaveBeenCalledWith({}, expect.stringContaining('next status-mail sync'));
    expect(logger.error).not.toHaveBeenCalled();
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).toHaveBeenCalledWith(tx);
    expect(reconcile.reconcileStaleAssignments).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleMissingStandardHoursProcess.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['transaction', 'replacement'])('continues external completion after %s failure', async (stage) => {
    vi.spyOn(pipeline, 'loadFkojunstMailSourceRows').mockResolvedValue({ scanned: 1,
      normalizedRows: [mockRow({ fsezono: '1', fkojun: '710', fkoteicd: '587' })],
      skippedInvalidStatus: 0, skippedUnparseableDate: 0, rowsRevision: '42' });
    const error = new Error('candidate refresh failed');
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValueOnce([{ revision: 42n }]).mockResolvedValueOnce([]),
      productionScheduleMissingStandardHoursProcess: { deleteMany: vi.fn().mockRejectedValue(error) } };
    const client = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    if (stage === 'transaction') client.$transaction.mockRejectedValueOnce(error);
    const reconcile = mockReconcileService();
    const service = new FkojunstExternalCompletionSyncService({ prismaClient: client as never,
      orderAssignmentReconciliationService: reconcile as never });
    await expect(service.syncFromCurrentStatusMailDashboard()).resolves.toEqual({ skipped: false });
    expect(logger.error).toHaveBeenCalledWith({ err: error }, expect.stringContaining('continuing external completion'));
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).toHaveBeenCalledWith(tx);
    expect(reconcile.reconcileStaleAssignments).toHaveBeenCalledTimes(1);
  });

});
