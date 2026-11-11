import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { save, usage, board, continueBoard } = vi.hoisted(() => ({
  save: vi.fn(), usage: vi.fn(), board: vi.fn(), continueBoard: vi.fn()
}));
vi.mock('../../../../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../api/client')>(),
  getKioskProductionScheduleLeaderboardBoard: board,
  postKioskProductionScheduleLeaderboardBoardContinue: continueBoard,
  postKioskProductionScheduleLeaderboardDecorations: vi.fn().mockResolvedValue({ rowDecorations: [] }),
  autoRankKioskProductionScheduleOrder: save,
  getKioskProductionScheduleOrderUsage: usage
}));
import { useKioskProductionScheduleOrderUsage } from '../../../../api/hooks/production-schedule/schedule';
import { productionScheduleQueryKeys } from '../../../../api/queryKeys/productionSchedule';
import { useSingleFlight } from '../../../../hooks/useSingleFlight';
import { isLeaderboardBoardInteractionLocked } from '../cache/leaderboardBoardInteractionLockPolicy';
import { useCompositeLeaderboardPhasedScheduleWithAutoAppend } from '../useCompositeLeaderboardPhasedScheduleWithAutoAppend';
import { useLeaderBoardSlotAutoRank } from '../useLeaderBoardSlotAutoRank';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../api/client';

beforeEach(() => {
  save.mockReset().mockResolvedValue({ success: true });
  usage.mockReset().mockResolvedValue({ '305': [1] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function setup(targetDeviceScopeKey?: string) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const cancel = vi.spyOn(client, 'cancelQueries');
  const onOrderSuccess = vi.fn();
  const onError = vi.fn();
  client.getMutationCache().config.onError = onError;
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => {
    const singleFlight = useSingleFlight();
    const writePause = singleFlight.pending;
    const interactionLocked = isLeaderboardBoardInteractionLocked({ isMutationInFlight: writePause });
    const usageQuery = useKioskProductionScheduleOrderUsage('305', { pauseRefetch: writePause, refetchIntervalMs: 1000 });
    const autoRank = useLeaderBoardSlotAutoRank({
      seibanEvalEnabled: true, interactionLocked, orderPending: false, singleFlight, onOrderSuccess,
      sortedGrouped: new Map([['305', ['r1', 'r2'].map(id => mkLeaderBoardRow({ id, resourceCd: '305', processingOrder: null }))]]),
      orderUsageByResourceCd: { '305': [1] }, targetDeviceScopeKey
    });
    return { ...autoRank, writePause, interactionLocked, usageQuery };
  }, { wrapper });
  return { ...hook, client, invalidate, cancel, onError, onOrderSuccess };
}

describe('useLeaderBoardSlotAutoRank', () => {
  it('saves one batch, patches each displayed row and cached rank without invalidating the fast path', async () => {
    const { result, client, invalidate, onOrderSuccess } = setup();
    const key = productionScheduleQueryKeys.schedule({});
    client.setQueryData(key, { rows: [{ id: 'r1', processingOrder: null }, { id: 'r2', processingOrder: null }] });
    await waitFor(() => expect(result.current.usageQuery.isSuccess).toBe(true));
    await act(async () => { result.current.handleAutoRankSlot('305'); });
    await waitFor(() => expect(result.current.writePause).toBe(false));
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '305', assignments: [
      { rowId: 'r1', orderNumber: 2 }, { rowId: 'r2', orderNumber: 3 }
    ] });
    expect(onOrderSuccess.mock.calls).toEqual([[{ rowId: 'r1', orderNumber: 2 }], [{ rowId: 'r2', orderNumber: 3 }]]);
    expect(client.getQueryData(key)).toEqual({ rows: [{ id: 'r1', processingOrder: 2 }, { id: 'r2', processingOrder: 3 }] });
    expect(client.getQueryData(productionScheduleQueryKeys.orderUsage('305'))).toEqual({ '305': [1, 2, 3] });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([new Error('offline'), new AxiosError('conflict', undefined, undefined, undefined, {
    status: 409, data: { message: '対象の行には既に順位が設定されています' }, headers: {}, statusText: 'Conflict', config: {} as never
  })])('handles %s from the UI callback without an unhandled rejection, and displays the existing error message', async (error) => {
    save.mockRejectedValueOnce(error);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    const { result, invalidate, cancel, onError, onOrderSuccess } = setup();
    try {
      await act(async () => { result.current.handleAutoRankSlot('305'); });
      await waitFor(() => expect(alert).toHaveBeenCalledExactlyOnceWith(
        error instanceof AxiosError ? error.response?.data.message : 'offline'
      ));
      expect(unhandled).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(error, expect.anything(), undefined, expect.anything(), expect.anything());
      expect(onOrderSuccess).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.leaderboardBoardAll });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.orderUsageAll });
      expect(invalidate).toHaveBeenCalledTimes(2);
      expect(cancel.mock.calls).toEqual([
        [{ queryKey: productionScheduleQueryKeys.leaderboardBoardAll }],
        [{ queryKey: productionScheduleQueryKeys.orderUsageAll }]
      ]);
    } finally { window.removeEventListener('unhandledrejection', unhandled); }
  });

  it('locks interactions, pauses polling during saving, and resumes after completion', async () => {
    let resolve!: (value: unknown) => void;
    save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result } = setup();
    await waitFor(() => expect(result.current.usageQuery.isSuccess).toBe(true));
    vi.useFakeTimers();
    act(() => { result.current.handleAutoRankSlot('305'); result.current.handleAutoRankSlot('305'); });
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.writePause).toBe(true);
    expect(result.current.interactionLocked).toBe(true);
    expect(result.current.autoRankDisabled).toBe(true);
    const calls = usage.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(usage).toHaveBeenCalledTimes(calls);
    await act(async () => { resolve({ success: true }); await Promise.resolve(); });
    expect(result.current.writePause).toBe(false);
    expect(result.current.interactionLocked).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(usage.mock.calls.length).toBeGreaterThan(calls);
  });

  it('releases single flight after failure and allows retry', async () => {
    save.mockRejectedValueOnce(new Error('offline'));
    const { result } = setup();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await act(async () => { result.current.handleAutoRankSlot('305'); });
    await waitFor(() => expect(alert).toHaveBeenCalledWith('offline'));
    expect(result.current.writePause).toBe(false);
    await act(async () => { result.current.handleAutoRankSlot('305'); });
    await waitFor(() => expect(result.current.writePause).toBe(false));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('recovers a conflict through the board query while keeping appended rows visible', async () => {
    vi.stubEnv('VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED', 'false');
    vi.stubEnv('VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER', 'true');
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    save.mockRejectedValueOnce(new AxiosError('conflict', undefined, undefined, undefined, {
      status: 409, data: {}, headers: {}, statusText: 'Conflict', config: {} as never
    }));
    const makeBoard = (snapshotId: string, complete: boolean, order: number | null): ProductionScheduleLeaderboardBoardResponse => ({
      page: 1, pageSize: 1, total: 2,
      rows: (complete ? ['r1', 'r2'] : ['r1']).map(id => ({
        id, rowData: { FSIGENCD: '305', FSEIBAN: 'S1' }, processingOrder: order
      } as ProductionScheduleRow)),
      resources: [{ resourceCd: '305', total: 2, pageSize: 1, hasMore: !complete,
        nextCursor: complete ? 2 : 1, snapshotId }]
    });
    board.mockReset().mockResolvedValueOnce(makeBoard('initial', false, null))
      .mockResolvedValue(makeBoard('refetched', false, 4));
    let finishContinue!: (value: ProductionScheduleLeaderboardBoardResponse) => void;
    continueBoard.mockReset().mockResolvedValueOnce(makeBoard('initial', true, null))
      .mockImplementationOnce(() => new Promise(resolve => { finishContinue = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => {
      const singleFlight = useSingleFlight();
      const composite = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {}, resourceCdsOrdered: ['305'], scheduleEnabled: true,
        pauseRefetch: singleFlight.pending, refetchIntervalMs: 120000,
        macManualOrderV2: false, activeDeviceScopeKey: '', siteKey: 'test'
      });
      const autoRank = useLeaderBoardSlotAutoRank({
        seibanEvalEnabled: true, interactionLocked: singleFlight.pending, orderPending: false, singleFlight,
        sortedGrouped: new Map([['305', [mkLeaderBoardRow({ id: 'r2', resourceCd: '305', processingOrder: null })]]]),
        orderUsageByResourceCd: {}, onOrderSuccess: vi.fn()
      });
      return { ...autoRank, rows: composite.scheduleQuery.data?.rows };
    }, { wrapper });
    await waitFor(() => expect(result.current.rows?.map(row => row.id)).toEqual(['r1', 'r2']));
    act(() => result.current.handleAutoRankSlot('305'));
    await waitFor(() => expect(continueBoard).toHaveBeenCalledTimes(2));
    expect(board).toHaveBeenCalledTimes(2);
    expect(result.current.rows?.map(row => row.id)).toEqual(['r1', 'r2']);
    await act(async () => { finishContinue(makeBoard('refetched', true, 4)); });
    await waitFor(() => expect(result.current.rows?.map(row => row.processingOrder)).toEqual([4, 4]));
    expect(result.current.rows?.map(row => row.id)).toEqual(['r1', 'r2']);
  });

  it('forwards the selected target device for proxy terminals', async () => {
    const { result } = setup('site - kioskB');
    await act(async () => { result.current.handleAutoRankSlot('305'); });
    await waitFor(() => expect(result.current.writePause).toBe(false));
    expect(save).toHaveBeenCalledExactlyOnceWith({ resourceCd: '305', targetDeviceScopeKey: 'site - kioskB', assignments: [
      { rowId: 'r1', orderNumber: 2 }, { rowId: 'r2', orderNumber: 3 }
    ] });
  });
});
