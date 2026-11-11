import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { AxiosError } from 'axios';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCompositeLeaderboardPhasedScheduleWithAutoAppend } from '../useCompositeLeaderboardPhasedScheduleWithAutoAppend';
import { leaderboardAppendRetryDelayMs } from '../useLeaderboardAppendRetry';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

const mocks = vi.hoisted(() => ({ continue: vi.fn(), board: vi.fn() }));
vi.mock('../../../../api/client', async (original) => ({
  ...await original<typeof import('../../../../api/client')>(),
  postKioskProductionScheduleLeaderboardBoardContinue: mocks.continue,
  postKioskProductionScheduleLeaderboardDecorations: vi.fn().mockResolvedValue({ rowDecorations: [], leaderboardFooterChipsByPartKey: {} })
}));
vi.mock('../../../../api/hooks', async (original) => ({
  ...await original<typeof import('../../../../api/hooks')>(),
  useKioskProductionScheduleLeaderboardBoard: mocks.board
}));

function board(count: number, hasMore = true): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1, pageSize: 1, total: 4,
    rows: Array.from({ length: count }, (_, n) => ({ id: `row-${n}`, rowData: { FSIGENCD: 'R1' } })) as ProductionScheduleLeaderboardBoardResponse['rows'],
    resources: [{ resourceCd: 'R1', hasMore, total: 4, pageSize: 1, nextCursor: count, snapshotId: 'snapshot' }]
  };
}
const options = {
  leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 1 },
  resourceCdsOrdered: ['R1'], scheduleEnabled: true, pauseRefetch: false,
  refetchIntervalMs: 120000, macManualOrderV2: false, activeDeviceScopeKey: '', siteKey: 'test'
};
let queryClient: QueryClient;
function wrapper({ children }: PropsWithChildren) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}
async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
function mount() {
  return renderHook(({ pageSize }) => useCompositeLeaderboardPhasedScheduleWithAutoAppend({
    ...options, leaderboardPhasedBaseParams: { ...options.leaderboardPhasedBaseParams, pageSize }
  }), { initialProps: { pageSize: 1 }, wrapper });
}

describe('append retry recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED', 'false');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shell = board(1);
    mocks.board.mockReturnValue({ data: shell, isSuccess: true, isPlaceholderData: false, dataUpdatedAt: 1000 });
    mocks.continue.mockReset().mockRejectedValue(new AxiosError('Network Error'));
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('待ち時間は1秒から倍増し、長期障害でも30秒を超えない', () => {
    expect([1, 2, 3, 4, 5, 6, 10000].map(leaderboardAppendRetryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('失敗直後や定期refetchでは再要求せず、待ち時間経過後だけ再試行する', async () => {
    const view = mount();
    await flush();
    expect(mocks.continue).toHaveBeenCalledTimes(1);
    // 同じ shell の定期再取得でも待ち時間を飛ばさない。
    mocks.board.mockReturnValue({ ...mocks.board.mock.results[0].value, dataUpdatedAt: 2000 });
    view.rerender({ pageSize: 1 });
    await flush(999);
    expect(mocks.continue).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(mocks.continue).toHaveBeenCalledTimes(2);
    await flush(1999);
    expect(mocks.continue).toHaveBeenCalledTimes(2);
    await flush(1);
    expect(mocks.continue).toHaveBeenCalledTimes(3);
    expect(view.result.current.appendError).toBeNull();
  });

  it('途中失敗後は保存済みのcursorから再開し、成功で連続失敗数を戻す', async () => {
    mocks.continue.mockReset()
      .mockRejectedValueOnce(new AxiosError('Network Error'))
      .mockResolvedValueOnce(board(2))
      .mockRejectedValueOnce(new AxiosError('Network Error'))
      .mockResolvedValueOnce(board(4, false));
    const view = mount();
    await flush();
    await flush(1000);
    expect(mocks.continue).toHaveBeenCalledTimes(3);
    expect(view.result.current.scheduleQuery.data?.rows).toHaveLength(2);
    await flush(999);
    expect(mocks.continue).toHaveBeenCalledTimes(3);
    await flush(1);
    expect(mocks.continue).toHaveBeenCalledTimes(4);
    expect(mocks.continue.mock.calls[3][0].resourceSlices[0].cursor).toBe(2);
    expect(view.result.current.scheduleQuery.data?.rows).toHaveLength(4);
    expect(view.result.current.listIncomplete).toBe(false);
  });

  it('params変更で旧タイマーを解除し、新しい条件は最初の待ち時間に戻る', async () => {
    const view = mount();
    await flush();
    await flush(1000);
    expect(mocks.continue).toHaveBeenCalledTimes(2);
    view.rerender({ pageSize: 2 });
    await flush();
    expect(mocks.continue).toHaveBeenCalledTimes(3);
    mocks.continue.mockResolvedValue(board(4, false));
    await flush(1000);
    expect(mocks.continue).toHaveBeenCalledTimes(4);
    await flush(30000);
    expect(mocks.continue).toHaveBeenCalledTimes(4);
  });

  it('恒久エラーは再試行せず、既存のappendErrorへ返す', async () => {
    mocks.continue.mockRejectedValue(new Error('invalid request'));
    const view = mount();
    await flush();
    expect(view.result.current.appendError?.message).toBe('invalid request');
    await flush(60000);
    expect(mocks.continue).toHaveBeenCalledTimes(1);
  });

  it('アンマウント後に到着した失敗は再試行タイマーを作らない', async () => {
    let reject!: (error: Error) => void;
    mocks.continue.mockReturnValue(new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    const view = mount();
    await flush();
    view.unmount();
    await act(async () => { reject(new AxiosError('Network Error')); });
    queryClient.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('行の中身だけが変わった再取得で打ち切られても、残りを取りに戻る', async () => {
    let resolve!: (value: ProductionScheduleLeaderboardBoardResponse) => void;
    mocks.continue.mockReset()
      .mockReturnValueOnce(new Promise((resolveRequest) => { resolve = resolveRequest; }))
      .mockResolvedValue(board(4, false));
    const view = mount();
    await flush();
    expect(mocks.continue).toHaveBeenCalledTimes(1);
    // 行IDもcursorも同じで、オブジェクトだけが新しい。
    mocks.board.mockReturnValue({ data: board(1), isSuccess: true, isPlaceholderData: false, dataUpdatedAt: 2000 });
    view.rerender({ pageSize: 1 });
    await flush();
    await act(async () => { resolve(board(2)); });
    await flush(1000);
    expect(mocks.continue).toHaveBeenCalledTimes(2);
    expect(view.result.current.scheduleQuery.data?.rows).toHaveLength(4);
    expect(view.result.current.listIncomplete).toBe(false);
  });

  it('アンマウントで再試行タイマーを解除する', async () => {
    const view = mount();
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    queryClient.clear();
    expect(vi.getTimerCount()).toBe(0);
    await flush(30000);
    expect(mocks.continue).toHaveBeenCalledTimes(1);
  });
});
