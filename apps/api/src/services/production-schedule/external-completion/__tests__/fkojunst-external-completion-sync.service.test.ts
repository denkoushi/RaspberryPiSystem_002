import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../../lib/logger.js';
import type { FkojunstMailNormalizedRow } from '../../fkojunst-status-mail-sync.pipeline.js';
import * as snapshotRepo from '../fkojunst-status-mail-dedupe-key-snapshot.repository.js';
import * as repo from '../fkojunst-external-completion-sync.repository.js';
import { FkojunstExternalCompletionSyncService } from '../fkojunst-external-completion-sync.service.js';

vi.mock('../fkojunst-external-completion-sync.repository.js', () => ({
  replaceAllWinnerExternalCompletionStatesFromMailSync: vi.fn(),
}));

vi.mock('../fkojunst-status-mail-dedupe-key-snapshot.repository.js', () => ({
  loadPreviousDedupeKeys: vi.fn(),
  replaceDedupeKeySnapshot: vi.fn(),
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

describe('FkojunstExternalCompletionSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.mocked(snapshotRepo.loadPreviousDedupeKeys).mockResolvedValue([]);
    vi.mocked(snapshotRepo.replaceDedupeKeySnapshot).mockResolvedValue(undefined);
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
    expect(snapshotRepo.replaceDedupeKeySnapshot).not.toHaveBeenCalled();
  });

  it('初回相当（前回スナップショット空）では消失キーは無く、現在キーだけスナップショット保存する', async () => {
    let txArg: unknown;
    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        txArg = { mockTx: true };
        await fn(txArg);
      }),
    };

    vi.mocked(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).mockResolvedValue(undefined);

    const svc = new FkojunstExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const rows = [
      mockRow({ fkojun: '10', fkoteicd: 'R01', fsezono: '0001', sourceRowId: 'a' }),
      mockRow({ fkojun: '10', fkoteicd: 'R01', fsezono: '0001', sourceRowId: 'b' }),
    ];

    const r = await svc.syncFromDedupedStatusMailRows(rows);

    expect(r).toEqual({ skipped: false, distinctKeys: 1, disappearedDistinctKeys: 0 });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).toHaveBeenCalledTimes(1);
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).toHaveBeenCalledWith(txArg, []);
    expect(snapshotRepo.replaceDedupeKeySnapshot).toHaveBeenCalledWith(txArg, ['10\tR01\t0001']);
  });

  it('前回にあったキーが今回の CSV から消えた場合、そのキー集合を repository に渡す', async () => {
    let txArg: unknown;
    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        txArg = { mockTx: true };
        await fn(txArg);
      }),
    };

    vi.mocked(snapshotRepo.loadPreviousDedupeKeys).mockResolvedValue(['10\tR01\t0001', '20\tR02\t0002']);
    vi.mocked(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).mockResolvedValue(undefined);

    const svc = new FkojunstExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const rows = [mockRow({ fkojun: '20', fkoteicd: 'R02', fsezono: '0002', sourceRowId: 'x' })];

    const r = await svc.syncFromDedupedStatusMailRows(rows);

    expect(r).toEqual({ skipped: false, distinctKeys: 1, disappearedDistinctKeys: 1 });
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).toHaveBeenCalledWith(txArg, ['10\tR01\t0001']);
    expect(snapshotRepo.replaceDedupeKeySnapshot).toHaveBeenCalledWith(txArg, ['20\tR02\t0002']);
  });

  it('前回キーが今回も存在する場合は消失扱いせず、最新キー集合だけを保存する', async () => {
    let txArg: unknown;
    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        txArg = { mockTx: true };
        await fn(txArg);
      }),
    };

    vi.mocked(snapshotRepo.loadPreviousDedupeKeys).mockResolvedValue(['10\tR01\t0001']);
    vi.mocked(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).mockResolvedValue(undefined);

    const svc = new FkojunstExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const rows = [
      mockRow({ fkojun: '10', fkoteicd: 'R01', fsezono: '0001', sourceRowId: 'keep' }),
      mockRow({ fkojun: '20', fkoteicd: 'R02', fsezono: '0002', sourceRowId: 'new' }),
    ];

    const r = await svc.syncFromDedupedStatusMailRows(rows);

    expect(r).toEqual({ skipped: false, distinctKeys: 2, disappearedDistinctKeys: 0 });
    expect(repo.replaceAllWinnerExternalCompletionStatesFromMailSync).toHaveBeenCalledWith(txArg, []);
    expect(snapshotRepo.replaceDedupeKeySnapshot).toHaveBeenCalledWith(txArg, ['10\tR01\t0001', '20\tR02\t0002']);
  });
});
