import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCsvImportScheduleRun } from './useCsvImportScheduleRun';

const mutateAsync = vi.fn();
const refetch = vi.fn();
let serverRunningIds: string[] = [];
const schedules = [{ id: 'a', schedule: '0 2 * * *', enabled: true, timezone: 'Asia/Tokyo' }];

vi.mock('../../../api/hooks', () => ({
  useCsvImportSchedules: () => ({
    data: { schedules, runningScheduleIds: serverRunningIds },
    refetch
  }),
  useCsvImportScheduleMutations: () => ({
    run: { mutateAsync }
  })
}));

describe('useCsvImportScheduleRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverRunningIds = [];
    refetch.mockImplementation(async () => ({
      isSuccess: true,
      data: { schedules, runningScheduleIds: serverRunningIds }
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([202, 409])('keeps running after %s until the server finishes, then stops polling', async (status) => {
    vi.useFakeTimers();
    if (status === 202) {
      mutateAsync.mockResolvedValue({ accepted: true, mode: 'background' });
    } else {
      mutateAsync.mockRejectedValue({ response: { status: 409 } });
    }
    const { result, rerender, unmount } = renderHook(() => useCsvImportScheduleRun({ schedules }));
    serverRunningIds = ['a'];
    await act(async () => { await result.current.handleRun('a'); });
    expect(result.current.runningScheduleIds).toContain('a');
    expect(result.current.runError.a).toBeNull();
    await act(async () => { await result.current.handleRun('a'); });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.runningScheduleIds).toContain('a');
    expect(refetch).toHaveBeenCalledTimes(2);

    serverRunningIds = [];
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    rerender();
    expect(result.current.runningScheduleIds).toEqual([]);
    expect(refetch).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(refetch).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('polls cron runs and stops when they finish', async () => {
    vi.useFakeTimers();
    serverRunningIds = ['a'];
    const { result, rerender, unmount } = renderHook(() => useCsvImportScheduleRun({ schedules }));
    expect(result.current.runningScheduleIds).toContain('a');
    await act(async () => { await result.current.handleRun('a'); });
    expect(mutateAsync).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(refetch).toHaveBeenCalledTimes(1);
    serverRunningIds = [];
    rerender();
    expect(result.current.runningScheduleIds).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(refetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('keeps an accepted run disabled when fetching server state fails', async () => {
    vi.useFakeTimers();
    mutateAsync.mockResolvedValue({ accepted: true, mode: 'background' });
    refetch.mockResolvedValue({ isSuccess: false });
    const { result, unmount } = renderHook(() => useCsvImportScheduleRun({ schedules }));
    await act(async () => { await result.current.handleRun('a'); });
    expect(result.current.runningScheduleIds).toContain('a');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.runningScheduleIds).toContain('a');
    unmount();
    const calls = refetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(refetch).toHaveBeenCalledTimes(calls);
  });

  it('ignores a second run while the first run is in progress', async () => {
    let finishRun!: (response: { message: string }) => void;
    mutateAsync.mockImplementation(
      () => new Promise<{ message: string }>((resolve) => {
        finishRun = resolve;
      })
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const schedules = [{ id: 'a', schedule: '0 2 * * *', enabled: true, timezone: 'Asia/Tokyo' }];

    const { result, unmount } = renderHook(() => useCsvImportScheduleRun({ schedules }));

    let firstRun!: Promise<void>;
    await act(async () => {
      firstRun = result.current.handleRun('a');
    });
    await act(async () => {
      await result.current.handleRun('a');
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);

    // 1回目の実行を最後まで待つ。待たずに終えると、テスト環境の終了後に hook の後始末が走り
    // 「window is not defined」の Unhandled Rejection で web ジョブ全体が落ちることがある
    await act(async () => {
      finishRun({ message: 'ok' });
      await firstRun;
    });
    expect(result.current.runningScheduleId).toBeNull();
    expect(result.current.runMessage.a).toBe('実行しました');
    unmount();
  });
});
