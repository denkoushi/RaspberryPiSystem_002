import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productionFixture } from './__perf__/fixture';
import { buildForwardPlanningBoardGanttLayout } from './gantt/planningBoardGanttLayout';
import { applyOptimisticOverride } from './planningBoardPageModel';
import { resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';
import { usePlanningBoardPageGantt } from './usePlanningBoardPageGantt';
import { usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';

import type { usePlanningBoardGantt } from './gantt/usePlanningBoardGantt';
import type { OrderPreview, ResourceOrderHistory, ResourceOrderSnapshot } from './planningBoardPageModel';
import type { PlanningBoardWriteResult } from './usePlanningBoardWriteQueue';
import type { GrindingPlanningBoardOverrideItemRequest, GrindingPlanningBoardResourceOrderBulkRequest } from '@raspi-system/shared-types';

type Options = Parameters<typeof usePlanningBoardPageGantt>[0];
const selection = vi.hoisted(() => ({ resource: '021' as string | null }));
vi.mock('./gantt/usePlanningBoardGantt', () => ({ usePlanningBoardGantt: (options: Parameters<typeof usePlanningBoardGantt>[0]) => ({
  mode: 'forward', scale: 14, capacityPending: false, dailyHoursByResource: {}, runsThroughBreaks: new Set(),
  singleResourceCd: selection.resource, singleResourceLanes: ['021', '022', '023'], resourceMinutes: undefined,
  layout: buildForwardPlanningBoardGanttLayout({ items: options.items, seibanOrder: options.seibanOrder,
    resources: ['021', '022', '023'], allocation: 'alternate', view: 'resource', dailyHoursByResource: {}, today: '2026-11-11', scale: 14 })
}) }));
const noop = () => {};
function fixture(count = 30) {
  const value = productionFixture(count, 1);
  value.resources = ['021', '022', '023'];
  value.items = value.items.map((item, index) => ({ ...item, kind: 'piece', parentItemId: `parent-${index % 10}`,
    fseiban: `S${index % 10}`, fhincd: `P${index % 10}`, originalResourceCd: '021', originalDueDate: '2026-11-20', effectiveDueDate: null,
    specialDue: null, processOrder: '10', unitRequiredMinutes: 30, requiredMinutes: 30, completedOpNos: [] }));
  value.seibans = [...new Set(value.items.map(item => item.fseiban))];
  return value;
}
function setup(input = fixture(), pending = new Set<string>()) {
  const calls: { kind: 'order' | 'override'; sourceRevision: string; resourceCd?: string;
    items: (GrindingPlanningBoardOverrideItemRequest | GrindingPlanningBoardResourceOrderBulkRequest['items'][number])[];
    resolve: (value: PlanningBoardWriteResult) => void; reject: (error: Error) => void }[] = [];
  const saveOrder = vi.fn((request: GrindingPlanningBoardResourceOrderBulkRequest) => new Promise<PlanningBoardWriteResult>((resolve, reject) => {
    calls.push({ kind: 'order', ...request, resolve, reject });
  }));
  const saveOverrides = vi.fn((sourceRevision: string, items: GrindingPlanningBoardOverrideItemRequest[]) => new Promise<PlanningBoardWriteResult>((resolve, reject) => {
    calls.push({ kind: 'override', sourceRevision, items, resolve, reject });
  }));
  const overrideRef: { current?: Options['enqueueOverrides'] } = {};
  const enqueueOverrides = vi.fn<Options['enqueueOverrides']>((...args) => overrideRef.current!(...args));
  const notify = vi.fn();
  const refresh = vi.fn().mockResolvedValue({ isError: false });
  const hook = renderHook(() => {
    const queue = usePlanningBoardWriteQueue({ scope: 'unit', items: input.items, order: input.seibans,
      sourceRevision: 'source-0', refresh, onStart: noop, onSuccess: noop, onError: noop });
    const currentItemsRef = useRef(queue.items);
    currentItemsRef.current = queue.items;
    const [preview, setPreview] = useState<OrderPreview | null>(null);
    const [history, setHistory] = useState<ResourceOrderHistory[]>([]);
    const historyId = useRef(0);
    const snapshotResourceOrder = (resourceCd: string): ResourceOrderSnapshot => ({ resourceCd,
      itemIds: sortGrindingPlanningBoardItems(currentItemsRef.current.filter(item => !item.isCompleted &&
        resolveGrindingPlanningBoardResource(item, 'alternate') === resourceCd), input.seibans, 'resource', 'alternate').map(item => item.itemId) });
    overrideRef.current = (originals, requests, label, onFailed, capturedSourceRevision, orderAction) => {
      const byId = new Map(requests.map(request => [request.itemId, request]));
      return queue.enqueue({ label, itemIds: originals.map(item => item.itemId), seibans: [...new Set(originals.map(item => item.fseiban))],
        order: Boolean(orderAction), onSaved: orderAction?.onSaved, onFailed,
        apply: display => ({ ...display, items: display.items.map(item => byId.has(item.itemId) ? applyOptimisticOverride(item, byId.get(item.itemId)!) : item) }),
        save: context => saveOverrides(capturedSourceRevision ?? context.sourceRevision, requests.map((request, index) => {
          const item = context.item(originals[index]!);
          return { ...request, itemRevision: item.itemRevision, overrideVersion: item.version };
        })) });
    };
    const page = usePlanningBoardPageGantt({
      focusedFseiban: null, sortedItemsBySeiban: new Map(), view: 'resource', visibleItems: queue.items, ganttItems: queue.items,
      arrivalFilterEnabled: true, nowMs: new Date('2026-11-11T08:00:00+09:00').getTime(), ganttEnabled: true, allocation: 'alternate', category: 'cutting',
      data: { resources: input.resources, siteKey: 'test' } as Options['data'], registeredFseibans: input.seibans,
      bulkReady: true, rankMutationReady: true, writeBlocked: false, writeQueue: queue, orderPreview: preview,
      resourceOrderHistory: history, historyScope: 'unit', currentItemsRef,
      hasPendingSeiban: (seiban, wholeOnly) => pending.has(seiban) || queue.hasPendingSeiban(seiban, wholeOnly), enqueueWrite: queue.enqueue,
      updateResourceOrderBulkAsync: saveOrder as Options['updateResourceOrderBulkAsync'], setColorBySeiban: noop,
      setFocusedFseiban: noop, setOpenFseibans: noop, setFocusedSeiban: noop, setScanFocusKey: noop, setScanNotice: noop,
      scopeReady: true, pinMode: false, canMoveResource: item => item.itemId !== 'blocked', snapshotResourceOrder, notify,
      resourceOrderHistoryId: historyId, enqueueOverrides, setResourceOrderHistory: setHistory,
      rememberResourceOrder: (id, snapshot) => setHistory(previous => {
        const existing = previous.find(entry => entry.id === id);
        return existing ? previous.map(entry => entry === existing ? { ...entry, orders: [...entry.orders, snapshot] } : entry)
          : [...previous, { id, scope: 'unit', orders: [snapshot] }];
      }), setPinMode: noop, setOrderPreview: setPreview, sourceRevision: 'source-0', rankConflict: false, orderConflict: false,
      updatePinsAsync: vi.fn()
    });
    return { page, queue, preview, history };
  });
  const acknowledge = async (index: number) => {
    const call = calls[index]!;
    await act(async () => call.resolve({ sourceRevision: `source-${index + 1}`, items: call.items.map((request, rank) => {
      const item = hook.result.current.queue.items.find(item => item.itemId === request.itemId)!;
      return { ...(call.kind === 'override' ? applyOptimisticOverride(item, request) : { ...item, alternateRank: rank + 1 }),
        itemRevision: `saved-${index}-${item.itemId}`, version: (request.overrideVersion ?? 0) + 1 };
    }) }));
  };
  return { ...hook, calls, saveOrder, saveOverrides, enqueueOverrides, acknowledge, notify };
}
beforeEach(() => { selection.resource = '021'; });

describe('unit order preview and writes', () => {
  it('starts grouped, keeps before when switching, and submits one lane bulk for ten interleaved parts', async () => {
    const h = setup();
    act(() => h.result.current.page.proposeResourceOrder());
    expect(h.result.current.preview?.method).toBe('group');
    const before = h.result.current.preview!.before;
    act(() => h.result.current.page.changeOrderMethod('round'));
    expect(h.result.current.preview?.method).toBe('round');
    expect(h.result.current.preview?.before).toBe(before);
    act(() => h.result.current.page.changeOrderMethod('group'));
    act(() => h.result.current.page.applyResourceOrder());
    expect(h.saveOrder).toHaveBeenCalledOnce();
    expect(h.calls[0]!.items).toHaveLength(30);
    expect(h.calls[0]!.items.length).toBeLessThanOrEqual(h.result.current.preview!.current['021']!.length);
    expect(h.enqueueOverrides).not.toHaveBeenCalled();
    await h.acknowledge(0);
    expect(h.result.current.preview).toBeNull();
    h.unmount();
  });

  it('previews destination bars, batches only changed pieces once, waits for acknowledgement, and undoes all moves', async () => {
    selection.resource = '021+022';
    const h = setup();
    act(() => h.result.current.page.proposeResourceOrder());
    act(() => h.result.current.page.changeOrderMethod('balance'));
    const preview = h.result.current.preview!;
    const changes = preview.resourceChanges!;
    expect(changes.length).toBeGreaterThan(1);
    expect(h.result.current.page.ganttLayout.groups.flatMap(group => group.rows.flatMap(row => row.bars))
      .filter(bar => changes.some(change => change.itemId === bar.item.itemId)).every(bar => bar.resource === '022')).toBe(true);
    act(() => h.result.current.page.applyResourceOrder());
    expect(h.enqueueOverrides).toHaveBeenCalledOnce();
    expect(h.saveOverrides).toHaveBeenCalledOnce();
    expect(h.calls[0]!.items).toHaveLength(changes.length);
    expect(h.calls[0]!.items.map(item => item.itemId)).toEqual(changes.map(change => change.itemId));
    expect(h.saveOrder).not.toHaveBeenCalled();
    await h.acknowledge(0);
    expect(h.calls[1]!.sourceRevision).toBe('source-1');
    await h.acknowledge(1);
    expect(h.calls[2]!.sourceRevision).toBe('source-2');
    expect(h.calls[2]!.items.every(item => item.itemRevision.startsWith('saved-0-'))).toBe(true);
    await h.acknowledge(2);
    expect(h.saveOrder).toHaveBeenCalledTimes(2);
    expect(h.result.current.history).toHaveLength(1);
    expect(h.result.current.history[0]!.restoreResources).toHaveLength(changes.length);
    act(() => h.result.current.page.undoResourceOrder());
    expect(h.enqueueOverrides).toHaveBeenCalledTimes(2);
    expect(h.calls[3]!.kind).toBe('override');
    expect(h.calls[3]!.items).toHaveLength(changes.length);
    expect(h.calls[3]!.items.every(item => 'resourceCd' in item && item.resourceCd === '021')).toBe(true);
    await h.acknowledge(3);
    expect(h.calls[4]!.sourceRevision).toBe('source-4');
    await h.acknowledge(4);
    expect(h.result.current.history).toEqual([]);
    expect(h.result.current.queue.items.every(item => resolveGrindingPlanningBoardResource(item, 'alternate') === '021')).toBe(true);
    h.unmount();
  });

  it('switches back from balance without retaining resource overrides', () => {
    selection.resource = '021+022';
    const h = setup();
    act(() => h.result.current.page.proposeResourceOrder());
    const grouped = h.result.current.preview!;
    act(() => h.result.current.page.changeOrderMethod('balance'));
    act(() => h.result.current.page.changeOrderMethod('group'));
    expect(h.result.current.preview?.proposal).toEqual(grouped.proposal);
    expect(h.result.current.preview?.options.items).toEqual(grouped.options.items);
    expect(h.result.current.preview?.before).toBe(grouped.before);
    expect(h.result.current.preview?.resourceChanges).toEqual([]);
    h.unmount();
  });

  it('does not save lane orders or undo history when resource overrides fail', async () => {
    selection.resource = '021+022';
    const h = setup();
    act(() => h.result.current.page.proposeResourceOrder());
    act(() => h.result.current.page.changeOrderMethod('balance'));
    act(() => h.result.current.page.applyResourceOrder());
    await act(async () => h.calls[0]!.reject(new Error('409 conflict')));
    expect(h.saveOrder).not.toHaveBeenCalled();
    expect(h.result.current.history).toEqual([]);
    expect(h.result.current.preview).toBeNull();
    h.unmount();
  });

  it('retains restore history if ordering fails after acknowledged resource moves', async () => {
    selection.resource = '021+022';
    const h = setup();
    act(() => h.result.current.page.proposeResourceOrder());
    act(() => h.result.current.page.changeOrderMethod('balance'));
    act(() => h.result.current.page.applyResourceOrder());
    await h.acknowledge(0);
    await act(async () => h.calls[1]!.reject(new Error('409 conflict')));
    expect(h.saveOrder).toHaveBeenCalledOnce();
    expect(h.result.current.history[0]!.restoreResources!.length).toBeGreaterThan(0);
    expect(h.result.current.preview).toBeNull();
    h.unmount();
  });

  it.each(['all-resources', 'ordinary-row', 'completed-unit', 'other-lane-unit'])(
    'retains legacy preview for %s', variant => {
      const input = fixture(3);
      input.items = input.items.map((item, index) => ({ ...item, originalDueDate: `2026-11-${20 - index}`,
        ...(variant === 'ordinary-row' ? { kind: 'row' as const, unitRequiredMinutes: undefined } : {}),
        ...(variant === 'completed-unit' ? { isCompleted: true } : {}),
        ...(variant === 'other-lane-unit' ? { originalResourceCd: '023' } : {}) }));
      if (variant === 'all-resources') selection.resource = null;
      const h = setup(input);
      act(() => h.result.current.page.proposeResourceOrder());
      expect(h.result.current.preview?.method).toBeUndefined();
      h.unmount();
    }
  );

  it.each(['group', 'balance'] as const)('rejects a lane over 500 items before saving, preserving undo capacity (%s)', method => {
    if (method === 'balance') selection.resource = '021+022';
    const h = setup(fixture(501));
    act(() => h.result.current.page.proposeResourceOrder());
    if (method === 'balance') act(() => h.result.current.page.changeOrderMethod('balance'));
    expect(h.result.current.preview).toBeNull();
    expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('500件'), 'error');
    expect(h.saveOrder).not.toHaveBeenCalled();
    h.unmount();
  });

  it('shows methods even when grouping makes no change, and applies a no-op without writing', () => {
    const h = setup(fixture(10));
    act(() => h.result.current.page.proposeResourceOrder());
    expect(h.result.current.preview?.method).toBe('group');
    act(() => h.result.current.page.applyResourceOrder());
    expect(h.result.current.preview).toBeNull();
    expect(h.saveOrder).not.toHaveBeenCalled();
    h.unmount();
  });

  it('supports the existing single resource move and undo through restoreResources', async () => {
    const input = fixture(2);
    const h = setup(input);
    act(() => h.result.current.page.moveResourceInGantt(h.result.current.queue.items[0]!, '022', null, 'after'));
    expect(h.enqueueOverrides).toHaveBeenCalledOnce();
    await h.acknowledge(0);
    await h.acknowledge(1);
    expect(h.result.current.history[0]!.restoreResources).toEqual([{ itemId: input.items[0]!.itemId, resourceCd: '021' }]);
    act(() => h.result.current.page.undoResourceOrder());
    await h.acknowledge(2);
    await h.acknowledge(3);
    expect(h.result.current.history).toEqual([]);
    expect(h.result.current.queue.items[0]!.effectiveResourceCd).toBe('021');
    h.unmount();
  });
});
