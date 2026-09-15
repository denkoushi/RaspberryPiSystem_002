import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';

import type { PlanningBoardWriteContext, PlanningBoardWriteResult } from './usePlanningBoardWriteQueue';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const items = ['a', 'b'].map((itemId) => ({ itemId, itemRevision: `${itemId}-0`, version: 0,
  fseiban: itemId, effectiveResourceCd: '305', alternateRank: null, specialDue: null,
  machineName: '機種名' } as GrindingPlanningBoardItem));
function setup() {
  const requests: { resolve: (value: PlanningBoardWriteResult) => void; reject: (error: Error) => void }[] = [];
  const save = vi.fn((_context: PlanningBoardWriteContext) => new Promise<PlanningBoardWriteResult>((resolve, reject) => requests.push({ resolve, reject })));
  const refresh = vi.fn().mockResolvedValue({ isError: false });
  const onError = vi.fn();
  const failed = vi.fn();
  const hook = renderHook(({ data, scope, order, sourceRevision }) => usePlanningBoardWriteQueue({
    scope, items: data, order, sourceRevision, refresh, onStart: vi.fn(), onSuccess: vi.fn(), onError
  }), { initialProps: { data: items, scope: 'site:grinding', order: ['a', 'b'], sourceRevision: 'board-0' } });
  const change = (id: string, rank: number) => {
    const original = hook.result.current.items.find((item) => item.itemId === id)!;
    act(() => { hook.result.current.enqueue({ label: '順位', itemIds: [id], seibans: [id],
      apply: (display) => ({ ...display, items: display.items.map((item) => item.itemId === id ? { ...item, alternateRank: rank } : item) }),
      save: (context) => save({ ...context, item: () => context.item(original) }), onFailed: failed
    }); });
  };
  const saved = (id: string, rank: number, version: number): PlanningBoardWriteResult => ({ sourceRevision: 'board-0',
    items: [{ ...items.find((item) => item.itemId === id)!, alternateRank: rank, version, itemRevision: `${id}-${version}`, machineName: null }] });
  return { ...hook, save, requests, refresh, onError, failed, change, saved };
}
describe('planning board background writes', () => {
  it('shows repeated input before saving and uses acknowledged revisions without losing hydrated fields', async () => {
    const h = setup(); h.change('a', 1); h.change('a', 2);
    expect(h.result.current.items[0].alternateRank).toBe(2);
    expect(h.save).toHaveBeenCalledTimes(1);
    await act(async () => h.requests[0].resolve(h.saved('a', 1, 1)));
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0].item(items[0])).toMatchObject({ itemRevision: 'a-1', version: 1 });
    h.rerender({ data: items, scope: 'site:grinding', order: ['a', 'b'], sourceRevision: 'board-0' });
    expect(h.result.current.items[0].alternateRank).toBe(2);
    await act(async () => h.requests[1].resolve(h.saved('a', 2, 2)));
    expect(h.result.current.items[0]).toMatchObject({ alternateRank: 2, machineName: '機種名' });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.result.current.pending).toBe(false);
  });
  it('cancels dependent input but retains confirmed writes and continues independent input', async () => {
    const h = setup(); h.change('a', 1);
    await act(async () => h.requests[0].resolve(h.saved('a', 1, 1)));
    h.change('a', 2); h.change('a', 3); h.change('b', 4);
    await act(async () => h.requests[1].reject(new Error('conflict')));
    expect(h.failed).toHaveBeenCalledTimes(2);
    expect(h.save).toHaveBeenCalledTimes(3);
    expect(h.result.current.items.map((item) => item.alternateRank)).toEqual([1, 4]);
    await act(async () => h.requests[2].resolve(h.saved('b', 4, 1)));
    expect(h.result.current.items.map((item) => item.alternateRank)).toEqual([1, 4]);
  });
  it('blocks further writes after failed recovery without replaying cancelled input', async () => {
    const h = setup(); h.refresh.mockResolvedValue({ isError: true }); h.change('a', 1); h.change('b', 2);
    await act(async () => h.requests[0].reject(new Error('offline')));
    expect(h.result.current.blocked).toBe(true); h.change('a', 3);
    expect(h.save).toHaveBeenCalledTimes(1); expect(h.failed).toHaveBeenCalledTimes(2);
  });
  it('ignores old responses and queued input after scope changes', async () => {
    const h = setup(); h.change('a', 1); h.change('a', 2);
    h.rerender({ data: items, scope: 'other', order: ['a', 'b'], sourceRevision: 'board-0' });
    await act(async () => h.requests[0].resolve(h.saved('a', 1, 1)));
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.result.current.items[0].alternateRank).toBeNull(); h.unmount();
  });
  it('reconciles a newer external order that arrived during the save', async () => {
    const h = setup();
    act(() => { h.result.current.enqueue({ label: '製番順', itemIds: [], seibans: [], order: true,
      apply: (display) => ({ ...display, order: ['b', 'a'] }), save: h.save }); });
    h.rerender({ data: items, scope: 'site:grinding', order: ['c', 'a'], sourceRevision: 'board-2' });
    await act(async () => h.requests[0].resolve({ order: ['b', 'a'], sourceRevision: 'board-1' }));
    expect(h.result.current.order).toEqual(['c', 'a']);
  });
});
