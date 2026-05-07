import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePersistedLeaderBoardSeibanEval } from '../usePersistedLeaderBoardSeibanEval';

describe('usePersistedLeaderBoardSeibanEval', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('同じ sharedHistory 内容で rerender しても localStorage を再保存しない', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result, rerender } = renderHook(
      ({ sharedHistory }) => usePersistedLeaderBoardSeibanEval('第2工場', 'DeviceA', sharedHistory),
      {
        initialProps: { sharedHistory: ['A', 'B'] as string[] }
      }
    );

    await waitFor(() => {
      expect(result.current.mergedRegisteredSeibanOrder).toEqual(['A', 'B']);
    });

    setItemSpy.mockClear();

    act(() => {
      rerender({ sharedHistory: ['A', 'B'] });
    });

    await waitFor(() => {
      expect(result.current.mergedRegisteredSeibanOrder).toEqual(['A', 'B']);
    });

    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
