import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { productionFixture } from './__perf__/fixture';
import { useDueSortHarness } from './__perf__/harness';
import { resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';

import type { OrderPreview } from './planningBoardPageModel';
import type { usePlanningBoardPageGantt } from './usePlanningBoardPageGantt';
import type { GrindingPlanningBoardResponse, GrindingPlanningBoardResourceOrderBulkRequest, GrindingPlanningBoardResourceOrderResponse, GrindingPlanningBoardTestBar } from '@raspi-system/shared-types';

vi.mock('../../../api/hooks', () => ({
  useKioskGrindingPlanningBoardResourceMinutes: () => ({ data: { ownSourceResourceCds: ['305'], values: [] } }),
  useUpdateKioskGrindingPlanningBoardResourceMinutesSource: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useKioskGrindingPlanningBoardResourceCapacity: () => ({ data: undefined }),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: vi.fn(), isPending: false, isError: false })
}));

type PageOptions = Partial<Parameters<typeof usePlanningBoardPageGantt>[0]>;
function setup(fixture = productionFixture(30, 2), pageOptions: PageOptions = {}) {
  const requests: { request: GrindingPlanningBoardResourceOrderBulkRequest; resolve: (value: GrindingPlanningBoardResourceOrderResponse) => void;
    reject: (error: Error) => void }[] = [];
  const save = vi.fn((request: GrindingPlanningBoardResourceOrderBulkRequest) => new Promise<GrindingPlanningBoardResourceOrderResponse>((resolve, reject) => {
    requests.push({ request, resolve, reject });
  }));
  const refresh = vi.fn().mockResolvedValue({ isError: false });
  const hook = renderHook((options) => useDueSortHarness(fixture, save, refresh, undefined, options), { initialProps: pageOptions });
  const acknowledge = async (index: number) => {
    const { request, resolve } = requests[index];
    await act(async () => { resolve({ sourceRevision: `source-${index + 1}`,
      items: request.items.map(({ itemId, overrideVersion }, rank) => ({ ...fixture.items.find((item) => item.itemId === itemId)!,
        alternateRank: rank + 1, itemRevision: `saved-${index}-${itemId}`, version: (overrideVersion ?? 0) + 1 })) }); });
  };
  return { ...hook, requests, save, refresh, acknowledge };
}

function mixedLane() {
  const fixture = productionFixture(4, 1);
  fixture.items = fixture.items.map((item, index) => ({ ...item, itemId: ['S1', 'S2', 'A', 'B'][index],
    fhincd: `part-${index}`, processOrder: '10', alternateRank: [1, 2, 1, 3][index],
    specialDue: index < 2 ? { kind: 'today', expiresAt: '2026-11-05T17:00:00+09:00' } : null }));
  const test: GrindingPlanningBoardTestBar = { kind: 'test', itemId: 'test:22a2ef84-772f-4822-b4e3-bc1c930a9c83',
    itemRevision: 'test:r1', version: 1, sequence: 1, name: 'T', resourceCd: '300', minutes: 30,
    alternateRank: 2, isCompleted: false, completedAt: null, deletedAt: null };
  const data: GrindingPlanningBoardResponse = { siteKey: 'site', category: 'grinding', view: 'resource', sourceRevision: 'source-0',
    boardVersion: 1, registeredFseibans: fixture.seibans, uncheckedFseibans: [], seibanOrder: fixture.seibans,
    resources: fixture.resources, items: fixture.items, testBars: [test], load: [], unknownRequiredMinutesCount: 0,
    seibanProgress: {}, snapshotId: 'snapshot-0', nextCursor: null };
  return { fixture, data, test, order: ['S1', 'S2', 'A', test.itemId, 'B'] };
}

describe('planning board mixed test-bar order', () => {
  it('snapshots special-due bands before ranks when sending a test-bar reorder', () => {
    const { fixture, data, test, order } = mixedLane();
    const h = setup(fixture, { data });
    act(() => h.result.current.page.gantt.testBarControls.reorder!(test, fixture.items[3]!, 'before'));
    expect(h.requests[0].request.items.map((item) => item.itemId)).toEqual(order);
    h.unmount();
  });

  it('undoes visible slots in band/rank order while preserving an unarrived normal bar', () => {
    const { fixture, data, order } = mixedLane();
    fixture.items[2] = { ...fixture.items[2], arrived: false };
    const h = setup(fixture, { data, arrivalFilterEnabled: true,
      resourceOrderHistory: [{ id: 1, scope: 'perf:grinding', orders: [{ resourceCd: '300', itemIds: order }] }] });
    act(() => h.result.current.page.undoResourceOrder());
    expect(h.requests[0].request.items.map((item) => item.itemId)).toEqual(order);
    h.unmount();
  });

  it.each([false, true])('saves the proposal revision after a newer board arrives (test bars: %s)', (withTest) => {
    const { fixture, data } = mixedLane();
    fixture.items = fixture.items.filter((item) => !item.specialDue).map((item, index) => ({ ...item,
      originalDueDate: index ? '2026-11-05' : '2026-11-20', effectiveDueDate: null }));
    const setOrderPreview = vi.fn();
    const options: PageOptions = { data: { ...data, items: fixture.items, testBars: withTest ? data.testBars : [] }, setOrderPreview };
    const h = setup(fixture, options);
    act(() => h.result.current.page.proposeResourceOrder());
    const preview: OrderPreview = setOrderPreview.mock.calls[0][0];
    expect(preview.sourceRevision).toBe('source-0');
    h.rerender({ ...options, sourceRevision: 'source-newer', orderPreview: preview,
      data: { ...options.data!, sourceRevision: 'source-newer' } });
    act(() => h.result.current.page.applyResourceOrder());
    expect(h.requests[0].request.sourceRevision).toBe(preview.sourceRevision);
    h.unmount();
  });
});

describe('planning board due order', () => {
  it('excludes missing-hours markers from due ordering and automatic proposals', () => {
    const fixture = productionFixture(30, 1);
    fixture.items = fixture.items.map((item, index) => ({ ...item, specialDue: null, originalDueDate: `2026-11-${String(30 - index).padStart(2, '0')}`, effectiveDueDate: null }));
    fixture.items[0] = { ...fixture.items[0], standardHoursMissing: true, requiredMinutes: null, requiredMinutesKnown: false };
    const setOrderPreview = vi.fn();
    const h = setup(fixture, { setOrderPreview });
    act(() => h.result.current.page.sortResourceOrdersByDue());
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].request.items).toHaveLength(29);
    expect(h.requests[0].request.items.some((item) => item.itemId === fixture.items[0].itemId)).toBe(false);
    h.unmount();
    const proposal = setup(fixture, { setOrderPreview });
    act(() => proposal.result.current.page.proposeResourceOrder());
    const preview = setOrderPreview.mock.calls.at(-1)?.[0] as OrderPreview;
    expect(preview).toBeDefined();
    expect(Object.values(preview.proposal).flat()).not.toContain(fixture.items[0].itemId);
    proposal.unmount();
  });

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
