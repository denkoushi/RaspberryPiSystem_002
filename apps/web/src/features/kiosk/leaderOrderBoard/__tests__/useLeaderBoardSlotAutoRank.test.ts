import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useLeaderBoardSlotAutoRank } from '../useLeaderBoardSlotAutoRank';

import { mkLeaderBoardRow } from './leaderBoardRowTestFixtures';

describe('useLeaderBoardSlotAutoRank', () => {
  it('allows auto rank while the background append list is incomplete', async () => {
    const updateOrderAsync = vi.fn().mockResolvedValue(undefined);
    const sortedGrouped = new Map([
      [
        '305',
        [
          mkLeaderBoardRow({ id: 'r1', resourceCd: '305', processingOrder: null }),
          mkLeaderBoardRow({ id: 'r2', resourceCd: '305', processingOrder: null })
        ]
      ]
    ]);

    const { result } = renderHook(() =>
      useLeaderBoardSlotAutoRank({
        seibanEvalEnabled: true,
        interactionLocked: false,
        orderPending: false,
        sortedGrouped,
        orderUsageByResourceCd: { '305': [1] },
        updateOrderAsync
      })
    );

    expect(result.current.autoRankDisabled).toBe(false);

    await act(async () => {
      await result.current.handleAutoRank('305');
    });

    expect(updateOrderAsync).toHaveBeenCalledTimes(2);
    expect(updateOrderAsync).toHaveBeenNthCalledWith(1, {
      rowId: 'r1',
      resourceCd: '305',
      orderNumber: 2
    });
    expect(updateOrderAsync).toHaveBeenNthCalledWith(2, {
      rowId: 'r2',
      resourceCd: '305',
      orderNumber: 3
    });
  });
});
