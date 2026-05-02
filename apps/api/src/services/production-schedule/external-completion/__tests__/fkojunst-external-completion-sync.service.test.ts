import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../../lib/logger.js';
import type { FkojunstMailNormalizedRow } from '../../fkojunst-status-mail-sync.pipeline.js';
import * as repo from '../fkojunst-external-completion-sync.repository.js';
import { FkojunstExternalCompletionSyncService } from '../fkojunst-external-completion-sync.service.js';

vi.mock('../fkojunst-external-completion-sync.repository.js', () => ({
  replaceAllWinnerExternalCompletionStates: vi.fn(),
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
  });

  it('dedupe 後 CSV が無い相当（配列空）なら同期しない', async () => {
    const prismaMock = { $transaction: vi.fn() };
    const svc = new FkojunstExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.syncFromDedupedStatusMailRows([]);

    expect(r).toEqual({ skipped: true, reason: 'empty_status_csv' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(repo.replaceAllWinnerExternalCompletionStates).not.toHaveBeenCalled();
  });

  it('キーがあるとき distinct キーで repository をトランザクション内から呼ぶ', async () => {
    let txArg: unknown;
    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
        txArg = { mockTx: true };
        await fn(txArg);
      }),
    };

    vi.mocked(repo.replaceAllWinnerExternalCompletionStates).mockResolvedValue(undefined);

    const svc = new FkojunstExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const rows = [
      mockRow({ fkojun: '10', fkoteicd: 'R01', fsezono: '0001', sourceRowId: 'a' }),
      mockRow({ fkojun: '10', fkoteicd: 'R01', fsezono: '0001', sourceRowId: 'b' }),
    ];

    const r = await svc.syncFromDedupedStatusMailRows(rows);

    expect(r).toEqual({ skipped: false, distinctKeys: 1 });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(repo.replaceAllWinnerExternalCompletionStates).toHaveBeenCalledTimes(1);
    expect(repo.replaceAllWinnerExternalCompletionStates).toHaveBeenCalledWith(txArg, ['10\tR01\t0001']);
  });
});
