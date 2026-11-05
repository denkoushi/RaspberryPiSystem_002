import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { productionFixture } from './__perf__/fixture';
import { useDueSortHarness } from './__perf__/harness';
import { resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';

import type { GrindingPlanningBoardResourceOrderBulkRequest, GrindingPlanningBoardResourceOrderResponse } from '@raspi-system/shared-types';

vi.mock('../../../api/hooks', () => ({
  useKioskGrindingPlanningBoardResourceCapacity: () => ({ data: undefined }),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: vi.fn(), isPending: false, isError: false })
}));

function setup(fixture = productionFixture(30, 2)) {
  const requests: { request: GrindingPlanningBoardResourceOrderBulkRequest; resolve: (value: GrindingPlanningBoardResourceOrderResponse) => void;
    reject: (error: Error) => void }[] = [];
  const save = vi.fn((request: GrindingPlanningBoardResourceOrderBulkRequest) => new Promise<GrindingPlanningBoardResourceOrderResponse>((resolve, reject) => {
    requests.push({ request, resolve, reject });
  }));
  const refresh = vi.fn().mockResolvedValue({ isError: false });
  const hook = renderHook(() => useDueSortHarness(fixture, save, refresh));
  const acknowledge = async (index: number) => {
    const { request, resolve } = requests[index];
    await act(async () => { resolve({ sourceRevision: `source-${index + 1}`,
      items: request.items.map(({ itemId, overrideVersion }, rank) => ({ ...fixture.items.find((item) => item.itemId === itemId)!,
        alternateRank: rank + 1, itemRevision: `saved-${index}-${itemId}`, version: (overrideVersion ?? 0) + 1 })) }); });
  };
  return { ...hook, requests, save, refresh, acknowledge };
}

describe('planning board due order', () => {
  it('keeps special due bands first, then due date, process and itemId, and excludes completed work', () => {
    const fixture = productionFixture(8, 1);
    fixture.items = fixture.items.map((item, i) => ({ ...item, fseiban: fixture.seibans[0],
      alternateRank: i + 1, specialDue: i < 2 ? { kind: 'today', expiresAt: i ? '2026-11-05T10:00:00Z' : '2026-11-05T11:00:00Z' } : null,
      originalDueDate: i === 2 ? null : i === 6 ? '2026-11-08' : '2026-11-09', effectiveDueDate: null,
      processOrder: i === 3 ? '20' : '10', itemId: i === 4 ? 'z' : i === 5 ? 'a' : item.itemId, isCompleted: i === 7 }));
    const h = setup(fixture);
    act(() => h.result.current.page.sortResourceOrdersByDue());
    expect(h.requests[0].request.items.map((item) => item.itemId)).toEqual(['item-0001', 'item-0000', 'item-0006', 'a', 'z', 'item-0003', 'item-0002']);
    expect(h.result.current.queue.items.find((item) => item.itemId === 'item-0007')!.alternateRank).toBe(8);
    h.unmount();
  });

  it.each([500, 501])('preserves the per-resource 500-item limit (%i items)', (count) => {
    const h = setup(productionFixture(count, 1));
    act(() => h.result.current.page.sortResourceOrdersByDue());
    expect(h.save).toHaveBeenCalledTimes(count === 500 ? 1 : 0);
    if (count === 500) expect(h.requests[0].request.items).toHaveLength(500);
    h.unmount();
  });

  it('keeps one undo entry, sequential resource saves, acknowledged revisions and one final refresh', async () => {
    const fixture = productionFixture(30, 2);
    const originalOrders = fixture.resources.map((resource) => sortGrindingPlanningBoardItems(fixture.items.filter((item) =>
      resolveGrindingPlanningBoardResource(item, 'alternate') === resource), fixture.seibans, 'resource', 'alternate').map((item) => item.itemId));
    const h = setup(fixture);
    act(() => h.result.current.page.sortResourceOrdersByDue());
    expect(h.save).toHaveBeenCalledTimes(1);
    await h.acknowledge(0);
    expect(h.requests[1].request.sourceRevision).toBe('source-1');
    await h.acknowledge(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.result.current.history).toHaveLength(1);
    expect(h.result.current.history[0].orders.map((order) => order.itemIds)).toEqual(originalOrders);
    act(() => h.result.current.page.undoResourceOrder());
    expect(h.requests[2].request.items.map((item) => item.itemId)).toEqual(originalOrders[0]);
    expect(h.requests[2].request.items.every((item) => item.itemRevision.startsWith('saved-0-') && item.overrideVersion === 2)).toBe(true);
    await h.acknowledge(2);
    await h.acknowledge(3);
    expect(h.result.current.history).toEqual([]);
    h.unmount();
  });

  it('cancels remaining resource orders on conflict while retaining confirmed order and undo history', async () => {
    const h = setup(productionFixture(60, 3));
    act(() => h.result.current.page.sortResourceOrdersByDue());
    await h.acknowledge(0);
    await act(async () => h.requests[1].reject(new Error('409 conflict')));
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.result.current.history).toHaveLength(1);
    expect(h.result.current.history[0].orders).toHaveLength(1);
    expect(h.result.current.queue.pending).toBe(false);
    expect(h.result.current.queue.items.filter((item) => item.itemRevision.startsWith('saved-0-'))).toHaveLength(20);
    h.unmount();
  });
});
