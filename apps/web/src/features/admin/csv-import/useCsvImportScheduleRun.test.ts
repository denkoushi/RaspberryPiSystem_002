import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCsvImportScheduleRun } from './useCsvImportScheduleRun';

const mutateAsync = vi.fn();

vi.mock('../../../api/hooks', () => ({
  useCsvImportScheduleMutations: () => ({
    run: { mutateAsync }
  })
}));

describe('useCsvImportScheduleRun', () => {
  it('ignores a second run while the first run is in progress', async () => {
    let finishRun!: (response: { message: string }) => void;
    mutateAsync.mockImplementation(
      () => new Promise<{ message: string }>((resolve) => {
        finishRun = resolve;
      })
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const refetch = vi.fn();
    const schedules = [{ id: 'a', schedule: '0 2 * * *', enabled: true, timezone: 'Asia/Tokyo' }];

    const { result, unmount } = renderHook(() => useCsvImportScheduleRun({ schedules, refetch }));

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
