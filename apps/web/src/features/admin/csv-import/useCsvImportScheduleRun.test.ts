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
    mutateAsync.mockImplementation(
      () => new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      })
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const refetch = vi.fn();
    const schedules = [{ id: 'a', schedule: '0 2 * * *', enabled: true, timezone: 'Asia/Tokyo' }];

    const { result } = renderHook(() => useCsvImportScheduleRun({ schedules, refetch }));

    await act(async () => {
      void result.current.handleRun('a');
    });
    await act(async () => {
      await result.current.handleRun('a');
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
