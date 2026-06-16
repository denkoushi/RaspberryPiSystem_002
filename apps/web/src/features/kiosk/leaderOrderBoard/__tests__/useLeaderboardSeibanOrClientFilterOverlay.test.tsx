import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { filterLeaderboardBoardBySeibanOr } from '../cache/filterLeaderboardBoardBySeibanOr';
import { runLeaderboardBoardAppendSession } from '../leaderboardBoardAppendSessionRunner';
import { useLeaderboardSeibanOrClientFilterOverlay } from '../useLeaderboardSeibanOrClientFilterOverlay';

import type {
  ProductionScheduleLeaderboardBoardResponse,
  ProductionScheduleRow
} from '../../../../api/client';

const getBoard = vi.fn();

const reconcileLeaderboardBoardCacheWithServerMock = vi.hoisted(() => vi.fn());

vi.mock('../cache/leaderboardBoardCacheReconcilePolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cache/leaderboardBoardCacheReconcilePolicy')>();
  return {
    ...actual,
    reconcileLeaderboardBoardCacheWithServer: (
      cached: Parameters<typeof actual.reconcileLeaderboardBoardCacheWithServer>[0],
      server: Parameters<typeof actual.reconcileLeaderboardBoardCacheWithServer>[1]
    ) => reconcileLeaderboardBoardCacheWithServerMock(cached, server)
  };
});

vi.mock('../../../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/client')>();
  return {
    ...actual,
    getKioskProductionScheduleLeaderboardBoard: (...args: unknown[]) => getBoard(...args)
  };
});

vi.mock('../leaderboardBoardAppendSessionRunner', () => ({
  runLeaderboardBoardAppendSession: vi.fn(
    async ({
      shell,
      refs,
      paramsKey
    }: {
      shell: ProductionScheduleLeaderboardBoardResponse;
      refs: {
        appendOverrideRef: { current: ProductionScheduleLeaderboardBoardResponse | null };
        appendOverrideParamsKeyRef: { current: string | null };
      };
      paramsKey: string;
    }) => {
      const completed: ProductionScheduleLeaderboardBoardResponse = {
        ...shell,
        totalsDeferred: false,
        total: 2,
        rows: [...shell.rows, row('r2')],
        resources: [{ resourceCd: 'R1', hasMore: false, total: 2, pageSize: 80 }]
      };
      refs.appendOverrideRef.current = completed;
      refs.appendOverrideParamsKeyRef.current = paramsKey;
    }
  )
}));

function row(id: string): ProductionScheduleRow {
  return {
    id,
    occurredAt: '2026-06-16T00:00:00.000Z',
    rowData: { FSIGENCD: 'R1', FSEIBAN: 'AA111111', ProductNo: id, FHINCD: `P-${id}` }
  };
}

function board(partial: Partial<ProductionScheduleLeaderboardBoardResponse>): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: partial.total ?? 1,
    rows: partial.rows ?? [row('r1')],
    resources: partial.resources ?? [{ resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }],
    ...partial
  };
}

describe('useLeaderboardSeibanOrClientFilterOverlay', () => {
  const seibanOrFilters = ['AA111111'];
  const orderedResourceCds = ['R1'];
  const leaderboardPhasedBaseParamsKey = JSON.stringify({ allowResourceOnly: true, pageSize: 80 });
  const setIsAppending = vi.fn();

  beforeEach(async () => {
    vi.stubEnv('VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER', 'true');
    getBoard.mockReset();
    vi.mocked(runLeaderboardBoardAppendSession).mockClear();
    reconcileLeaderboardBoardCacheWithServerMock.mockReset();
    const actual = await vi.importActual<
      typeof import('../cache/leaderboardBoardCacheReconcilePolicy')
    >('../cache/leaderboardBoardCacheReconcilePolicy');
    reconcileLeaderboardBoardCacheWithServerMock.mockImplementation(actual.reconcileLeaderboardBoardCacheWithServer);
  });

  it('reconcile GET は deferTotals=true を送り、hasMore 完走後に server 正で r1/r2 を維持する', async () => {
    const networkDisplayBoard = board({
      total: 1,
      rows: [row('r1')],
      resources: [{ resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }]
    });

    getBoard.mockResolvedValue(
      board({
        totalsDeferred: true,
        total: 1,
        rows: [row('r1')],
        resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 1, total: 1, pageSize: 80 }]
      })
    );

    expect(
      filterLeaderboardBoardBySeibanOr(networkDisplayBoard, seibanOrFilters, orderedResourceCds)
    ).not.toBeNull();

    const appendRunIdRef = { current: 0 };

    const { result } = renderHook(() =>
      useLeaderboardSeibanOrClientFilterOverlay({
        enabled: true,
        seibanOrFilters,
        orderedResourceCds,
        leaderboardPhasedBaseParamsKey,
        displayBoard: networkDisplayBoard,
        networkDisplayBoard,
        networkBoardComplete: true,
        appendRunIdRef,
        setIsAppending
      })
    );

    await waitFor(() => {
      expect(getBoard).toHaveBeenCalledTimes(1);
      expect(runLeaderboardBoardAppendSession).toHaveBeenCalledTimes(1);
      expect(reconcileLeaderboardBoardCacheWithServerMock).toHaveBeenCalledTimes(1);
    });

    const params = getBoard.mock.calls[0]?.[0] as { deferTotals?: boolean; q?: string };
    expect(params.deferTotals).toBe(true);
    expect(params.q).toBe('AA111111');

    await waitFor(() => {
      expect(reconcileLeaderboardBoardCacheWithServerMock).toHaveBeenCalled();
      const serverArg = reconcileLeaderboardBoardCacheWithServerMock.mock.calls.at(-1)?.[1] as
        | ProductionScheduleLeaderboardBoardResponse
        | undefined;
      expect(serverArg?.rows.map((r) => r.id)).toEqual(['r1', 'r2']);
      const reconcileResult = reconcileLeaderboardBoardCacheWithServerMock.mock.results.at(-1)?.value as {
        kind: string;
      };
      expect(reconcileResult.kind).toBe('serverWins');
    });

    await waitFor(() => {
      const rowIds = result.current.displayBoardForUi?.rows.map((r) => r.id) ?? [];
      expect(rowIds).toEqual(['r1', 'r2']);
    });

    expect(result.current.displayBoardForUi?.resources.every((r) => r.hasMore === false)).toBe(true);
    expect(result.current.listIncompleteForUi).toBe(false);
  });
});
