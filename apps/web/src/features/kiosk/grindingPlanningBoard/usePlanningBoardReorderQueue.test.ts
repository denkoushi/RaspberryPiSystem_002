import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';
import { usePlanningBoardReorderQueue } from './usePlanningBoardReorderQueue';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceOrderRequest, GrindingPlanningBoardResourceOrderResponse } from '@raspi-system/shared-types';
const items = ['a', 'b', 'c'].map((itemId, index) => ({ itemId, itemRevision: `${itemId}-0`, version: 0,
  fseiban: 'S', originalResourceCd: '305', effectiveResourceCd: '305', alternateRank: index + 1, specialDue: null,
  machineName: '機種名', isCompleted: false } as GrindingPlanningBoardItem));
const saved = (ids: string[], version: number) => ({ sourceRevision: 'board', items: ids.map((id, index) => ({
  ...items.find((item) => item.itemId === id)!, alternateRank: index + 1, version, itemRevision: `${id}-${version}`, machineName: null
})) });
function setup() {
  const requests: { resolve: (value: GrindingPlanningBoardResourceOrderResponse) => void; reject: (error: Error) => void }[] = [];
  const save = vi.fn((_request: GrindingPlanningBoardResourceOrderRequest) => new Promise<GrindingPlanningBoardResourceOrderResponse>((resolve, reject) => requests.push({ resolve, reject })));
  const refresh = vi.fn().mockResolvedValue({ isError: false });
  const onError = vi.fn();
  const hook = renderHook(({ data, scope }) => usePlanningBoardReorderQueue({
    scope, items: data, seibanOrder: ['S'], sourceRevision: 'board', save, refresh,
    onStart: vi.fn(), onSuccess: vi.fn(), onError
  }), { initialProps: { data: items, scope: 'site:grinding' } });
  const order = () => sortGrindingPlanningBoardItems(hook.result.current.items, ['S'], 'resource', 'alternate').map((item) => item.itemId);
  const move = (source: string, target: string) => act(() => hook.result.current.enqueue({
    item: hook.result.current.items.find((item) => item.itemId === source)!, target: hook.result.current.items.find((item) => item.itemId === target)!, placement: 'before'
  }));
  return { ...hook, requests, save, refresh, onError, order, move };
}
describe('resource reorder queue', () => {
  it('shows consecutive moves immediately and sends confirmed revisions serially', async () => {
    const h = setup(); h.move('c', 'a'); h.move('b', 'c');
    expect(h.order()).toEqual(['b', 'c', 'a']); expect(h.save).toHaveBeenCalledTimes(1);
    await act(async () => h.requests[0].resolve(saved(['c', 'a', 'b'], 1)));
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1]).toMatchObject([{ itemId: 'b', itemRevision: 'b-1', targetItemId: 'c', targetItemRevision: 'c-1' }]);
    expect(h.order()).toEqual(['b', 'c', 'a']);
    h.rerender({ data: items.map((item) => ({ ...item })), scope: 'site:grinding' });
    expect(h.order()).toEqual(['b', 'c', 'a']);
    await act(async () => h.requests[1].resolve(saved(['b', 'c', 'a'], 2)));
    expect(h.result.current.pending).toBe(false); expect(h.order()).toEqual(['b', 'c', 'a']);
    expect(h.result.current.items[0].machineName).toBe('機種名');
    h.rerender({ data: saved(['a', 'c', 'b'], 3).items, scope: 'site:grinding' });
    await waitFor(() => expect(h.order()).toEqual(['a', 'c', 'b']));
  });
  it('stops subsequent writes on failure and reconciles', async () => {
    const h = setup(); h.move('c', 'a'); h.move('b', 'c');
    await act(async () => h.requests[0].reject(new Error('conflict')));
    expect(h.save).toHaveBeenCalledTimes(1); expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledTimes(1); expect(h.order()).toEqual(['a', 'b', 'c']);
    expect(h.result.current.pending).toBe(false);
  });
  it('blocks uncertain follow-up writes when reconciliation fails', async () => {
    const h = setup(); h.refresh.mockResolvedValue({ isError: true }); h.move('c', 'a');
    await act(async () => h.requests[0].reject(new Error('offline')));
    expect(h.result.current.blocked).toBe(true); h.move('b', 'a'); expect(h.save).toHaveBeenCalledTimes(1);
  });
  it('does not send queued moves or apply old responses across scopes', async () => {
    const h = setup(); h.move('c', 'a'); h.move('b', 'c');
    h.rerender({ data: items, scope: 'other:grinding' });
    await act(async () => h.requests[0].resolve(saved(['c', 'a', 'b'], 1)));
    expect(h.save).toHaveBeenCalledTimes(1); expect(h.order()).toEqual(['a', 'b', 'c']); h.unmount();
  });
});
