import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLeaderboardDecorationFetchBatches, useLeaderboardDeferredBoardDecorations } from '../useLeaderboardDeferredBoardDecorations';

import type {
  LeaderboardBoardResourceSliceResponse,
  ProductionScheduleRow,
  ProductionScheduleLeaderboardBoardResponse,
  ProductionScheduleLeaderboardDecorationsResponse
} from '../../../../api/client';

function row(id: string, resourceCd: string): ProductionScheduleRow {
  return {
    id,
    occurredAt: '2026-06-16T00:00:00.000Z',
    rowData: {
      FSIGENCD: resourceCd,
      ProductNo: id,
      FSEIBAN: `S-${id}`,
      FHINCD: `P-${id}`
    }
  };
}

function resource(resourceCd: string): LeaderboardBoardResourceSliceResponse {
  return {
    resourceCd,
    hasMore: false,
    total: 0,
    pageSize: 80
  };
}

describe('buildLeaderboardDecorationFetchBatches', () => {
  it('スロット順に各資源の上位行を優先バッチへ入れる', () => {
    const r1Rows = Array.from({ length: 10 }, (_, index) => row(`r1-${index + 1}`, 'R1'));
    const r2Rows = Array.from({ length: 10 }, (_, index) => row(`r2-${index + 1}`, 'R2'));
    const rows = [...r1Rows, ...r2Rows];

    const result = buildLeaderboardDecorationFetchBatches({
      rows,
      resources: [resource('R2'), resource('R1')],
      pendingRowIds: rows.map((r) => r.id)
    });

    expect(result.priorityRowIds).toEqual([
      'r2-1',
      'r2-2',
      'r2-3',
      'r2-4',
      'r2-5',
      'r2-6',
      'r2-7',
      'r2-8',
      'r1-1',
      'r1-2',
      'r1-3',
      'r1-4',
      'r1-5',
      'r1-6',
      'r1-7',
      'r1-8'
    ]);
    expect(result.backgroundRowIdBatches).toEqual([
      ['r1-9', 'r1-10', 'r2-9', 'r2-10']
    ]);
  });

  it('資源順が解決できないときも先頭バッチを返す', () => {
    const rows = Array.from({ length: 3 }, (_, index) => row(`r-${index + 1}`, 'R1'));

    const result = buildLeaderboardDecorationFetchBatches({
      rows,
      resources: [],
      pendingRowIds: rows.map((r) => r.id)
    });

    expect(result.priorityRowIds).toEqual(['r-1', 'r-2', 'r-3']);
    expect(result.backgroundRowIdBatches).toEqual([]);
  });

  it('rowId と資源コードの前後空白を正規化して優先バッチを作る', () => {
    const rows = [row(' r-1 ', ' R1 '), row('r-2', 'R1')];

    const result = buildLeaderboardDecorationFetchBatches({
      rows,
      resources: [resource(' R1 ')],
      pendingRowIds: [' r-1 ', 'r-2']
    });

    expect(result.priorityRowIds).toEqual(['r-1', 'r-2']);
    expect(result.backgroundRowIdBatches).toEqual([]);
  });
});

const postDecorations = vi.hoisted(() => vi.fn());
vi.mock('../../../../api/client', () => ({
  postKioskProductionScheduleLeaderboardDecorations: postDecorations
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function decorations(ids: string[]): ProductionScheduleLeaderboardDecorationsResponse {
  return {
    rowDecorations: ids.map((id) => ({
      id, resolvedMachineName: `machine-${id}`, customerName: null, hasSelfInspectionDrawing: false,
      selfInspectionTemplateId: null, selfInspectionStatus: null, selfInspectionEntryPath: null,
      selfInspectionResourceCds: [], selfInspectionResourceCd: null
    })),
    leaderboardFooterChipsByPartKey: {}
  };
}

function board(ids: string[]): ProductionScheduleLeaderboardBoardResponse {
  return { page: 1, pageSize: 80, total: ids.length, rows: ids.map((id) => row(id, 'R1')), resources: [resource('R1')] };
}

const initialOptions = {
  scheduleEnabled: true, paramsKey: 'scope-1', displayBoard: board(['r-1']),
  boardNetworkSyncToken: 'sync-1', macManualOrderV2: false, activeDeviceScopeKey: 'device-1', pauseRefetch: false
};

describe('useLeaderboardDeferredBoardDecorations worker', () => {
  beforeEach(() => { postDecorations.mockReset(); });

  it('accepts in-flight priority/background results across appends and fetches each row only once', async () => {
    const priority = deferred<ProductionScheduleLeaderboardDecorationsResponse>();
    const background = deferred<ProductionScheduleLeaderboardDecorationsResponse>();
    const initialIds = Array.from({ length: 10 }, (_, i) => `r-${i + 1}`);
    postDecorations.mockReturnValueOnce(priority.promise).mockReturnValueOnce(background.promise)
      .mockImplementation(async ({ rowIds }: { rowIds: string[] }) => decorations(rowIds));
    const hook = renderHook(useLeaderboardDeferredBoardDecorations, {
      initialProps: { ...initialOptions, displayBoard: board(initialIds) }
    });
    expect(postDecorations).toHaveBeenCalledOnce();
    hook.rerender({ ...initialOptions, displayBoard: board([...initialIds, 'r-11']) });
    expect(postDecorations).toHaveBeenCalledOnce();
    await act(async () => priority.resolve(decorations(initialIds.slice(0, 8))));
    expect(hook.result.current.accumulatedDecorations.rowDecorationsById.get('r-1')?.resolvedMachineName).toBe('machine-r-1');
    await waitFor(() => expect(postDecorations).toHaveBeenCalledTimes(2));
    hook.rerender({ ...initialOptions, displayBoard: board([...initialIds, 'r-11', 'r-12']) });
    await act(async () => background.resolve(decorations(initialIds.slice(8))));
    await waitFor(() => expect(hook.result.current.accumulatedDecorations.rowDecorationsById.size).toBe(12));
    const requestedIds = postDecorations.mock.calls.flatMap(([request]) => request.rowIds as string[]);
    expect(requestedIds).toEqual([...initialIds, 'r-11', 'r-12']);
    hook.rerender({ ...initialOptions, displayBoard: board([...initialIds, 'r-11', 'r-12']) });
    expect(postDecorations).toHaveBeenCalledTimes(3);
    hook.unmount();
  });

  it.each(['boardNetworkSyncToken', 'paramsKey', 'pauseRefetch'] as const)('%s cancels the old result and restarts', async (key) => {
    const oldRequest = deferred<ProductionScheduleLeaderboardDecorationsResponse>();
    const newRequest = deferred<ProductionScheduleLeaderboardDecorationsResponse>();
    postDecorations.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const hook = renderHook(useLeaderboardDeferredBoardDecorations, { initialProps: initialOptions });
    const nextOptions = { ...initialOptions, [key]: key === 'pauseRefetch' ? true : 'new-generation' };
    hook.rerender(nextOptions);
    if (key === 'pauseRefetch') {
      expect(postDecorations).toHaveBeenCalledOnce();
      hook.rerender(initialOptions);
    }
    expect(postDecorations).toHaveBeenCalledTimes(2);
    await act(async () => oldRequest.resolve(decorations(['r-1'])));
    expect(hook.result.current.accumulatedDecorations.rowDecorationsById.size).toBe(0);
    await act(async () => newRequest.resolve(decorations(['r-1'])));
    await waitFor(() => expect(hook.result.current.accumulatedDecorations.rowDecorationsById.size).toBe(1));
    expect(postDecorations).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('does not retry failed rows when new chunks arrive in the same sync generation', async () => {
    postDecorations.mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async ({ rowIds }: { rowIds: string[] }) => decorations(rowIds));
    const hook = renderHook(useLeaderboardDeferredBoardDecorations, { initialProps: initialOptions });
    await waitFor(() => expect(hook.result.current.decorationsError?.message).toBe('offline'));
    hook.rerender({ ...initialOptions, displayBoard: board(['r-1', 'r-2']) });
    await waitFor(() => expect(hook.result.current.accumulatedDecorations.rowDecorationsById.has('r-2')).toBe(true));
    expect(postDecorations.mock.calls.map(([request]) => request.rowIds)).toEqual([['r-1'], ['r-2']]);
    hook.unmount();
  });
});
