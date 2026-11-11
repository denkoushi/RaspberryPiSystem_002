import { act, cleanup, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../../../api/client';
import { usePlanningBoardWriteQueue } from '../usePlanningBoardWriteQueue';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { PlanningBoardOfflineProvider, useFrozenValue, usePlanningBoardOffline } from './PlanningBoardOfflineProvider';

import type { PlanningBoardWriteResult } from '../usePlanningBoardWriteQueue';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { AxiosResponse } from 'axios';

const items = [{ itemId: 'a', itemRevision: 'a-0', version: 0, fseiban: 'a', alternateRank: null } as GrindingPlanningBoardItem];
const config = { ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('offline queue generations', () => {
  it.each(['resolve', 'reject'] as const)('discards unsent writes and ignores a late %s without changing the frozen projection', async (settlement) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    let reachable = true;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      if (!reachable) throw new Error('Offline');
      return { status: 200, data: { dailyHoursByResource: {}, runsThroughBreaksResources: [] } } as AxiosResponse;
    });
    let finish!: (value: PlanningBoardWriteResult) => void; let fail!: (error: Error) => void;
    const save = vi.fn(() => new Promise<PlanningBoardWriteResult>((resolve, reject) => { finish = resolve; fail = reject; }));
    const onSaved = vi.fn(); const onFailed = vi.fn(); const onDiscarded = vi.fn(); const refresh = vi.fn();
    let queue!: ReturnType<typeof usePlanningBoardWriteQueue>; let displayed!: GrindingPlanningBoardItem[];
    function Harness() {
      const { registerRead } = usePlanningBoardOffline();
      useLayoutEffect(() => registerRead('board', { read: async () => items, commit: () => undefined }), [registerRead]);
      queue = usePlanningBoardWriteQueue({ scope: 'site', items, order: ['a'], sourceRevision: 'board-0', refresh,
        onStart: vi.fn(), onSuccess: vi.fn(), onError: vi.fn() });
      displayed = useFrozenValue(queue.items);
      return null;
    }
    render(<PlanningBoardOfflineProvider config={config}><Harness /></PlanningBoardOfflineProvider>);
    await advance(5000);
    for (const rank of [1, 2]) act(() => { queue.enqueue({ label: '順位', itemIds: ['a'], seibans: ['a'],
      apply: (display) => ({ ...display, items: display.items.map((item) => ({ ...item, alternateRank: rank })) }),
      save, onSaved, onFailed, onDiscarded }); });
    expect(displayed[0].alternateRank).toBe(2); expect(save).toHaveBeenCalledTimes(1);
    reachable = false; await advance(15000);
    expect(onDiscarded).toHaveBeenCalledTimes(2);
    await act(async () => { if (settlement === 'resolve') finish({ items: [{ ...items[0], alternateRank: 1 }] }); else fail(new Error('Late failure')); });
    expect(displayed[0].alternateRank).toBe(2); expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled(); expect(onFailed).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
    reachable = true; await advance(10000);
    expect(displayed[0].alternateRank).toBeNull(); expect(save).toHaveBeenCalledTimes(1);
  });
});
