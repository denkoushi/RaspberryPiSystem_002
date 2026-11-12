import { useMemo } from 'react';

import { isVisibleByArrival } from '../isVisibleByArrival';

import { planningBoardAutoOrder, planningBoardLaneOrder, planningBoardOrderMetrics } from './gantt/planningBoardAutoOrder';
import { buildForwardPlanningBoardGanttLayout, planningBoardVisibleBars } from './gantt/planningBoardGanttLayout';
import { mergeUnitOrderLane, planningBoardUnitOrder } from './gantt/planningBoardUnitOrder';
import { isUnitPiece } from './gantt/planningBoardUnitSegments';
import { usePlanningBoardGantt } from './gantt/usePlanningBoardGantt';
import { mergeVisibleResourceOrder } from './mergeVisibleResourceOrder';
import { usePlanningBoardOffline } from './offline/PlanningBoardOfflineProvider';
import { applyOptimisticOverride, EMPTY_ORDER, todayJst } from './planningBoardPageModel';
import { planningBoardPair, planningBoardResourceMatches } from './planningBoardTwoMachine';
import { comparePlanningBoardBarOrder, compareProcessOrder, resolveGrindingPlanningBoardDueDate, resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';
import { isPendingPlanningTestBar, usePlanningBoardTestBars } from './usePlanningBoardTestBars';

import type { GanttLayoutOptions } from './gantt/planningBoardGanttLayout';
import type { UnitOrderMethod } from './gantt/planningBoardUnitOrder';
import type { FeedbackKind, OrderPreview, ResourceOrderHistory, ResourceOrderSnapshot } from './planningBoardPageModel';
import type { PlanningBoardAllocation } from './types';
import type { usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';
import type { useUpdateKioskGrindingPlanningBoardPins, useUpdateKioskGrindingPlanningBoardResourceOrderBulk } from '../../../api/hooks';
import type { GrindingPlanningBoardBar, GrindingPlanningBoardCategory, GrindingPlanningBoardItem, GrindingPlanningBoardOverrideItemRequest, GrindingPlanningBoardResourceOrderPlacement, GrindingPlanningBoardResponse, GrindingPlanningBoardView } from '@raspi-system/shared-types';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type Options = {
  focusedFseiban: string | null;
  sortedItemsBySeiban: Map<string, GrindingPlanningBoardItem[]>;
  view: GrindingPlanningBoardView;
  visibleItems: GrindingPlanningBoardItem[];
  ganttItems: GrindingPlanningBoardItem[];
  arrivalFilterEnabled: boolean;
  nowMs: number;
  ganttEnabled: boolean;
  allocation: PlanningBoardAllocation;
  category: GrindingPlanningBoardCategory;
  data: GrindingPlanningBoardResponse | undefined;
  registeredFseibans: string[];
  scheduleSource?: 'general' | 'dCompany' | 'both';
  bulkReady: boolean;
  rankMutationReady: boolean;
  writeBlocked: boolean;
  writeQueue: ReturnType<typeof usePlanningBoardWriteQueue>;
  orderPreview: OrderPreview | null;
  resourceOrderHistory: ResourceOrderHistory[];
  historyScope: string;
  currentItemsRef: MutableRefObject<GrindingPlanningBoardItem[]>;
  hasPendingSeiban: ReturnType<typeof usePlanningBoardWriteQueue>['hasPendingSeiban'];
  enqueueWrite: ReturnType<typeof usePlanningBoardWriteQueue>['enqueue'];
  updateResourceOrderBulkAsync: ReturnType<typeof useUpdateKioskGrindingPlanningBoardResourceOrderBulk>['mutateAsync'];
  setColorBySeiban: Dispatch<SetStateAction<boolean>>;
  setFocusedFseiban: Dispatch<SetStateAction<string | null>>;
  setOpenFseibans: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setFocusedSeiban: Dispatch<SetStateAction<string | null>>;
  setScanFocusKey: Dispatch<SetStateAction<number>>;
  setScanNotice: Dispatch<SetStateAction<{ text: string } | null>>;
  scopeReady: boolean;
  pinMode: boolean;
  canMoveResource: (item: GrindingPlanningBoardItem, target: string) => boolean;
  snapshotResourceOrder: (resource: string) => ResourceOrderSnapshot;
  notify: (message: string, kind: FeedbackKind) => void;
  resourceOrderHistoryId: MutableRefObject<number>;
  enqueueOverrides: (
    originals: readonly GrindingPlanningBoardItem[], requests: GrindingPlanningBoardOverrideItemRequest[],
    label: string, onFailed?: (error: unknown) => void, capturedSourceRevision?: string, orderAction?: { onSaved: () => void }
  ) => boolean;
  setResourceOrderHistory: Dispatch<SetStateAction<ResourceOrderHistory[]>>;
  rememberResourceOrder: (id: number, snapshot: ResourceOrderSnapshot) => void;
  setPinMode: Dispatch<SetStateAction<boolean>>;
  setOrderPreview: Dispatch<SetStateAction<OrderPreview | null>>;
  sourceRevision: string;
  rankConflict: boolean;
  orderConflict: boolean;
  updatePinsAsync: ReturnType<typeof useUpdateKioskGrindingPlanningBoardPins>['mutateAsync'];
};

export function usePlanningBoardPageGantt({
  focusedFseiban, sortedItemsBySeiban, view, visibleItems, ganttItems, arrivalFilterEnabled, nowMs, ganttEnabled, allocation, category,
  data, registeredFseibans, scheduleSource, bulkReady, rankMutationReady, writeBlocked, writeQueue, orderPreview,
  resourceOrderHistory, historyScope, currentItemsRef, hasPendingSeiban, enqueueWrite, updateResourceOrderBulkAsync,
  setColorBySeiban, setFocusedFseiban, setOpenFseibans, setFocusedSeiban, setScanFocusKey, setScanNotice,
  scopeReady, pinMode, canMoveResource, snapshotResourceOrder: normalSnapshotResourceOrder, notify, resourceOrderHistoryId, enqueueOverrides,
  setResourceOrderHistory, rememberResourceOrder, setPinMode, setOrderPreview, sourceRevision, rankConflict,
  orderConflict, updatePinsAsync
}: Options) {
  const { gate, enabled: offlineEnabled } = usePlanningBoardOffline();
  const today = offlineEnabled ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(nowMs)) : todayJst();
  const focusItems = useMemo(
    () => focusedFseiban ? sortedItemsBySeiban.get(focusedFseiban) ?? [] : [],
    [focusedFseiban, sortedItemsBySeiban]
  );
  const orderItems = useMemo(() => ganttItems.filter((item) => isVisibleByArrival(item, arrivalFilterEnabled)), [ganttItems, arrivalFilterEnabled]);
  const ganttNow = useMemo(() => new Date(nowMs), [nowMs]);
  const tests = usePlanningBoardTestBars({ data, items: writeQueue.items, enqueue: enqueueWrite,
    disabled: !scopeReady || !rankMutationReady || writeBlocked || writeQueue.pending || Boolean(orderPreview) || pinMode || allocation !== 'alternate',
    remember: (item, action, restoreAfterItemId) => { const id = ++resourceOrderHistoryId.current;
      setResourceOrderHistory((history) => [...history, { id, scope: historyScope, orders: [], testBarUndo: { item, action, restoreAfterItemId } }].slice(-10)); }
  });
  const baseGantt = usePlanningBoardGantt({ enabled: ganttEnabled, machineSelectionLocked: Boolean(orderPreview), items: ganttItems, testBars: tests.bars, arrivalFilterEnabled, allocation, view, category, resourceCategories: data?.resourceCategories,
    seibanOrder: registeredFseibans, resources: data?.resources ?? EMPTY_ORDER,
    today, now: ganttNow, preferenceScope: `${data?.siteKey ?? ''}:${category}` });
  const gantt = { ...baseGantt, testBarControls: { ...tests, reorder: (item: GrindingPlanningBoardBar, target: GrindingPlanningBoardBar, placement: 'before' | 'after') => {
    if (tests.disabled || isPendingPlanningTestBar(item) || isPendingPlanningTestBar(target) || item.isCompleted || target.isCompleted) return;
    const resource = resolveGrindingPlanningBoardResource(item, 'alternate');
    if (!resource || resource !== resolveGrindingPlanningBoardResource(target, 'alternate')) return;
    const before = snapshotResourceOrder(resource);
    const ids = before.itemIds.filter((id) => id !== item.itemId);
    const at = ids.indexOf(target.itemId); if (at < 0) return;
    ids.splice(at + (placement === 'after' ? 1 : 0), 0, item.itemId);
    const id = ++resourceOrderHistoryId.current;
    enqueueResourceOrder({ resourceCd: resource, itemIds: ids }, '順番', () => rememberResourceOrder(id, before));
  } } };
  const snapshotResourceOrder = (resource: string): ResourceOrderSnapshot => {
    const normal = normalSnapshotResourceOrder(resource);
    const byId = new Map(currentItemsRef.current.map((item) => [item.itemId, item]));
    const laneTests = tests.bars.filter((item) => item.resourceCd === resource && !item.isCompleted && !item.deletedAt);
    if (!laneTests.length) return normal;
    const mixed: GrindingPlanningBoardBar[] = [...normal.itemIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []), ...laneTests];
    mixed.sort(comparePlanningBoardBarOrder);
    return { resourceCd: resource, itemIds: mixed.map((item) => item.itemId) };
  };
  const orderActionsDisabled = !bulkReady || !rankMutationReady || writeBlocked || writeQueue.pending || gantt.capacityPending;
  const ganttLayout = useMemo(() => orderPreview
    ? buildForwardPlanningBoardGanttLayout({ ...orderPreview.options, scale: gantt.scale, laneOrder: orderPreview.proposal })
    : gantt.layout, [orderPreview, gantt.scale, gantt.layout]);
  const lastResourceOrder = resourceOrderHistory.filter((entry) => entry.scope === historyScope).at(-1);
  const enqueueResourceOrder = (snapshot: ResourceOrderSnapshot, label: string, onSaved: () => void, preview?: OrderPreview, onFailed?: () => void,
    sourceItems = currentItemsRef.current) => {
    if (!gate.attempt()) return false;
    const sourceById = new Map<string, GrindingPlanningBoardBar>([...sourceItems, ...tests.bars].map((item) => [item.itemId, item]));
    const items = snapshot.itemIds.map((id) => sourceById.get(id));
    if (!items.length || items.length > 500 || items.some((item) => !item || isPendingPlanningTestBar(item) || item.isCompleted ||
      (resolveGrindingPlanningBoardResource(item, 'alternate') ?? '未設定') !== snapshot.resourceCd || (item.kind !== 'test' && hasPendingSeiban(item.fseiban, true)))) return false;
    const members = items as GrindingPlanningBoardBar[];
    const ranks = new Map(snapshot.itemIds.map((id, index) => [id, index + 1]));
    return enqueueWrite({ label, itemIds: snapshot.itemIds, seibans: [...new Set(members.flatMap((item) => item.kind === 'test' ? [] : [item.fseiban]))], order: true,
      apply: (display) => ({ ...display, items: display.items.map((item) => ranks.has(item.itemId) ? { ...item, alternateRank: ranks.get(item.itemId)! } : item) }),
      save: (context) => gate.run(() => updateResourceOrderBulkAsync({ ...(scheduleSource == null ? {} : { scheduleSource }), sourceRevision: preview?.sourceRevision ?? context.sourceRevision, resourceCd: snapshot.resourceCd,
        items: members.map((original) => { const item = original.kind === 'test' ? tests.bars.find((item) => item.itemId === original.itemId) ?? original : context.item(original); return { itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version }; }) })),
      onSaved: (result) => { tests.accept(result); onSaved(); }, onFailed
    });
  };
  const handleOrderScan = (productNo: string): string | null => {
    const displayedItems = ganttEnabled
      ? planningBoardVisibleBars(ganttLayout).map((bar) => bar.item)
      : view === 'seiban' && focusedFseiban && focusItems.length > 0 ? focusItems : visibleItems;
    const item = displayedItems.filter((candidate): candidate is GrindingPlanningBoardItem => candidate.kind !== 'test').find((candidate) => candidate.productNo === productNo);
    if (!item) return ganttEnabled ? `${productNo} の棒はこのガントにありません。` : `${productNo} の行はこの画面にありません。`;
    if (ganttEnabled) setColorBySeiban(true);
    else if (view === 'seiban') {
      setFocusedFseiban(null);
      setOpenFseibans((current) => new Set(current).add(item.fseiban));
    }
    setFocusedSeiban(item.fseiban);
    setScanFocusKey((key) => key + 1);
    setScanNotice({ text: `${productNo} → 製番 ${item.fseiban}` });
    return null;
  };

  const moveResourceInGantt = (original: GrindingPlanningBoardItem, targetResource: string, targetItem: GrindingPlanningBoardItem | null,
    placement: GrindingPlanningBoardResourceOrderPlacement) => {
    if (!gate.attempt()) return;
    const item = currentItemsRef.current.find((candidate) => candidate.itemId === original.itemId);
    if (!item || !data || !scopeReady || !rankMutationReady || writeBlocked || allocation !== 'alternate' || item.isCompleted || orderPreview || pinMode ||
      !data.resources.includes(targetResource) || !canMoveResource(item, targetResource) || hasPendingSeiban(item.fseiban, true)) return;
    const previousResource = resolveGrindingPlanningBoardResource(item, allocation);
    if (previousResource === targetResource) return;
    const before = [snapshotResourceOrder(previousResource ?? '未設定'), snapshotResourceOrder(targetResource)];
    const target = targetItem && currentItemsRef.current.find((candidate) => candidate.itemId === targetItem.itemId);
    if (targetItem && (!target || target.isCompleted || !before[1]!.itemIds.includes(target.itemId))) return;
    const affected = currentItemsRef.current.filter((candidate) => before.some((snapshot) => snapshot.itemIds.includes(candidate.itemId)));
    if (affected.some((candidate) => hasPendingSeiban(candidate.fseiban, true))) return;
    if (before[0]!.itemIds.length > 500 || before[1]!.itemIds.length >= 500) {
      notify('移動する対象は資源ごとに500件までです。表示を確認してください。', 'error'); return;
    }
    const sameBand = !target || (item.specialDue?.expiresAt ?? null) === (target.specialDue?.expiresAt ?? null);
    const proposed = [...before[1]!.itemIds];
    proposed.splice(target ? proposed.indexOf(target.itemId) + (placement === 'after' ? 1 : 0) : proposed.length, 0, item.itemId);
    const id = ++resourceOrderHistoryId.current;
    const request = { itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, resourceCd: targetResource };
    if (!enqueueOverrides([item], [request], '資源CD', undefined, undefined, { onSaved: () => {
      setResourceOrderHistory((history) => [...history, { id, scope: historyScope, orders: before,
        restoreResources: [{ itemId: item.itemId, resourceCd: previousResource }] }].slice(-10));
    } })) return;
    // A resource change clears alternateRank. Queue the complete destination order after its override acknowledgement.
    if (sameBand) enqueueResourceOrder({ resourceCd: targetResource, itemIds: proposed }, '資源CDと順番', () => {}, undefined, undefined,
      currentItemsRef.current.map((candidate) => candidate.itemId === item.itemId ? applyOptimisticOverride(candidate, request) : candidate));
  };
  const sortResourceOrdersByDue = () => {
    if (!gate.attempt()) return;
    if (gantt.mode !== 'forward' || allocation !== 'alternate' || orderActionsDisabled) return;
    const id = ++resourceOrderHistoryId.current;
    const itemsByResource = new Map<string, GrindingPlanningBoardItem[]>();
    for (const item of orderItems) {
      if (item.isCompleted) continue;
      const resource = resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定';
      if (gantt.singleResourceCd && !planningBoardResourceMatches(gantt.singleResourceCd, resource, gantt.singleResourceLanes)) continue;
      const members = itemsByResource.get(resource);
      if (members) members.push(item);
      else itemsByResource.set(resource, [item]);
    }
    for (const [resourceCd, members] of itemsByResource) {
      const visible = sortGrindingPlanningBoardItems(members, registeredFseibans, 'resource', allocation);
      const sorted = [...visible].sort((a, b) => {
        if (a.specialDue || b.specialDue) return a.specialDue ? b.specialDue ? 0 : -1 : 1;
        return (resolveGrindingPlanningBoardDueDate(a, allocation) ?? '9999-12-31').localeCompare(resolveGrindingPlanningBoardDueDate(b, allocation) ?? '9999-12-31') ||
          compareProcessOrder(a.processOrder, b.processOrder) || a.itemId.localeCompare(b.itemId);
      });
      if (sorted.every((item, index) => item.itemId === visible[index]!.itemId)) continue;
      const before = snapshotResourceOrder(resourceCd);
      const itemIds = mergeVisibleResourceOrder(before.itemIds, sorted.map((item) => item.itemId));
      if (!enqueueResourceOrder({ resourceCd, itemIds }, '納期順', () => rememberResourceOrder(id, before))) {
        notify('並べ替える対象は資源ごとに500件までです。表示を確認してください。', 'error');
      }
    }
  };
  const proposeResourceOrder = (method: UnitOrderMethod = 'group', previous?: OrderPreview | null) => {
    if (!gate.attempt()) return;
    if (gantt.mode !== 'forward' || view !== 'resource' || allocation !== 'alternate' || orderActionsDisabled) return;
    const options: GanttLayoutOptions = { items: ganttItems, testBars: tests.bars, arrivalFilterEnabled, allocation, view, category, resourceCategories: data?.resourceCategories,
      seibanOrder: registeredFseibans, resources: data?.resources ?? EMPTY_ORDER, resourceMinutes: gantt.resourceMinutes, dailyHoursByResource: gantt.dailyHoursByResource, runsThroughBreaks: gantt.runsThroughBreaks,
      today, scale: gantt.scale, now: ganttNow };
    const resources: string[] = gantt.singleResourceCd ? planningBoardPair(gantt.singleResourceCd, gantt.singleResourceLanes) ?? [gantt.singleResourceCd] : [];
    const unitMethod = resources.length && orderItems.some(item => !item.isCompleted && isUnitPiece(item) &&
      resources.includes(resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定')) ? method : undefined;
    if (unitMethod === 'balance' && resources.length !== 2) return;
    if (unitMethod) {
      const base = previous ? { ...previous.options, items: ganttItems } : options;
      const current = previous?.current ?? planningBoardLaneOrder(base);
      const { proposal, resourceChanges } = planningBoardUnitOrder(base, resources, unitMethod, {
        visibleItemIds: new Set(orderItems.map(item => item.itemId)), canMoveResource,
        hasPendingSeiban: (fseiban) => hasPendingSeiban(fseiban, true)
      });
      if (resources.some(resource => proposal[resource]!.length > 500 || (current[resource]?.length ?? 0) > 500) || resourceChanges.length > 2000) {
        notify('並べ替える対象は資源ごとに500件までです。表示を確認してください。', 'error'); return;
      }
      const changes = new Map(resourceChanges.map(change => [change.itemId, change]));
      const previewOptions = { ...base, items: base.items.map(item => {
        const change = changes.get(item.itemId);
        return change ? applyOptimisticOverride(item, { ...change, itemRevision: item.itemRevision }) : item;
      }) };
      setPinMode(false);
      setOrderPreview({ options: previewOptions, sourceRevision: previous?.sourceRevision ?? sourceRevision,
        current, proposal, method: unitMethod, resourceChanges,
        before: previous?.before ?? planningBoardOrderMetrics(buildForwardPlanningBoardGanttLayout(base), true),
        after: planningBoardOrderMetrics(buildForwardPlanningBoardGanttLayout({ ...previewOptions, laneOrder: proposal }), true) });
      return;
    }
    const current = planningBoardLaneOrder(options);
    const visibleProposal = planningBoardAutoOrder({ ...options, items: orderItems }, new Set(orderItems.filter((item) => item.orderPinned).map((item) => item.itemId)));
    const proposal = Object.fromEntries(Object.entries(current).map(([resource, itemIds]) =>
      [resource, mergeVisibleResourceOrder(itemIds, visibleProposal[resource] ?? [])]));
    const changed = Object.keys(proposal).filter((resource) => proposal[resource]!.some((id, index) => id !== current[resource]?.[index]));
    if (!changed.length) { notify('並べ替える必要はありません', 'success'); return; }
    if (changed.some((resource) => proposal[resource]!.length > 500)) {
      notify('並べ替える対象は資源ごとに500件までです。表示を確認してください。', 'error'); return;
    }
    setPinMode(false);
    setOrderPreview({ options, sourceRevision, current, proposal, before: planningBoardOrderMetrics(buildForwardPlanningBoardGanttLayout(options)),
      after: planningBoardOrderMetrics(buildForwardPlanningBoardGanttLayout({ ...options, laneOrder: proposal })) });
  };
  const applyResourceOrder = () => {
    if (!gate.attempt()) return;
    if (!orderPreview || writeQueue.pending || writeQueue.blocked || rankConflict || orderConflict) return;
    const preview = orderPreview;
    const changed = Object.keys(preview.proposal).filter((resource) => preview.proposal[resource]!.length !== (preview.current[resource]?.length ?? 0) ||
      preview.proposal[resource]!.some((id, index) => id !== preview.current[resource]?.[index]));
    const id = ++resourceOrderHistoryId.current;
    if (preview.resourceChanges?.length) {
      const changes = preview.resourceChanges;
      const originals = changes.map(change => currentItemsRef.current.find(item => item.itemId === change.itemId));
      if (originals.some((item, index) => !item || item.isCompleted || item.orderPinned || item.specialDue ||
        !canMoveResource(item, changes[index]!.resourceCd) || hasPendingSeiban(item.fseiban, true))) {
        setOrderPreview(null);
        notify('対象の工程が変わったため並べ替えできません。表示を確認してください。', 'error'); return;
      }
      const resources = [...new Set(changes.flatMap(change => [change.previousResourceCd ?? '未設定', change.resourceCd]))];
      const before = resources.map(snapshotResourceOrder);
      // Unchecked seibans are absent from the proposal; keep them in their full-lane slots.
      const fullProposal = Object.fromEntries(before.map(snapshot => [snapshot.resourceCd,
        mergeUnitOrderLane(snapshot.itemIds, preview.current[snapshot.resourceCd] ?? [], preview.proposal[snapshot.resourceCd] ?? [])]));
      if (resources.some(resource => fullProposal[resource]!.length > 500) || changes.length > 2000) {
        notify('並べ替える対象は資源ごとに500件までです。表示を確認してください。', 'error'); return;
      }
      const members = originals as GrindingPlanningBoardItem[];
      const requests = members.map((item, index) => ({ itemId: item.itemId, itemRevision: item.itemRevision,
        overrideVersion: item.version, resourceCd: changes[index]!.resourceCd }));
      if (!enqueueOverrides(members, requests, '資源CDと並べ替え', () => setOrderPreview(null), preview.sourceRevision, { onSaved: () => {
        setResourceOrderHistory(history => [...history, { id, scope: historyScope, orders: before,
          restoreResources: changes.map(change => ({ itemId: change.itemId, resourceCd: change.previousResourceCd })) }].slice(-10));
        let remaining = resources.filter(resource => fullProposal[resource]!.length).length;
        if (!remaining) setOrderPreview(null);
        for (const resourceCd of resources) {
          if (!fullProposal[resourceCd]!.length) continue;
          if (!enqueueResourceOrder({ resourceCd, itemIds: fullProposal[resourceCd]! }, '並べ替え', () => {
            if (--remaining === 0) setOrderPreview(null);
          }, undefined, () => setOrderPreview(null), [...preview.options.items])) {
            setOrderPreview(null);
            notify('対象の工程が変わったため並べ替えできません。表示を確認してください。', 'error'); break;
          }
        }
      } })) {
        setOrderPreview(null);
        notify('対象の工程が変わったため並べ替えできません。表示を確認してください。', 'error');
      }
      return;
    }
    if (!changed.length) { setOrderPreview(null); return; }
    let remaining = changed.length;
    for (const resourceCd of changed) {
      const before = snapshotResourceOrder(resourceCd);
      const itemIds = mergeVisibleResourceOrder(before.itemIds, preview.proposal[resourceCd]!);
      if (!enqueueResourceOrder({ resourceCd, itemIds }, '並べ替え', () => {
        rememberResourceOrder(id, before);
        if (--remaining === 0) setOrderPreview(null);
      }, preview, () => setOrderPreview(null))) {
        setOrderPreview(null);
        notify('対象の工程が変わったため並べ替えできません。表示を確認してください。', 'error');
        break;
      }
    }
  };
  const togglePin = (original: GrindingPlanningBoardItem) => {
    if (!gate.attempt()) return;
    if (!pinMode || orderActionsDisabled || original.isCompleted) return;
    const item = currentItemsRef.current.find((candidate) => candidate.itemId === original.itemId);
    if (!item) return;
    const pinned = !item.orderPinned;
    enqueueWrite({ label: pinned ? '固定' : '固定の解除', itemIds: [item.itemId], seibans: [item.fseiban],
      apply: (display) => ({ ...display, items: display.items.map((entry) => entry.itemId === item.itemId ? { ...entry, orderPinned: pinned } : entry) }),
      save: (context) => { const current = context.item(item); return gate.run(() => updatePinsAsync({ sourceRevision: context.sourceRevision, pinned,
        items: [{ itemId: current.itemId, itemRevision: current.itemRevision, overrideVersion: current.version }] })); }
    });
  };
  const undoResourceOrder = () => {
    if (!gate.attempt()) return;
    if (gantt.mode !== 'forward' || allocation !== 'alternate' || orderActionsDisabled || !lastResourceOrder) return;
    if (lastResourceOrder.testBarUndo) { tests.undo(lastResourceOrder, () => setResourceOrderHistory((history) => history.filter((entry) => entry.id !== lastResourceOrder.id))); return; }
    let restoredItems = currentItemsRef.current;
    if (lastResourceOrder.restoreResources?.length) {
      const restores = new Map(lastResourceOrder.restoreResources.map(restore => [restore.itemId, restore]));
      const items = restoredItems.filter(item => restores.has(item.itemId));
      if (items.length !== restores.size || items.some(item => item.isCompleted || hasPendingSeiban(item.fseiban, true))) {
        notify('対象の工程が変わったため移動を戻せません。表示を確認してください。', 'error'); return;
      }
      const requests = items.map(item => ({ ...restores.get(item.itemId)!, itemRevision: item.itemRevision, overrideVersion: item.version }));
      if (!enqueueOverrides(items, requests, '資源CDを戻す', undefined, undefined, { onSaved: () => {
        setResourceOrderHistory((history) => history.map((entry) => entry.id === lastResourceOrder.id ? { ...entry, restoreResources: undefined } : entry));
      } })) return;
      const byId = new Map(requests.map(request => [request.itemId, request]));
      restoredItems = restoredItems.map(item => byId.has(item.itemId) ? applyOptimisticOverride(item, byId.get(item.itemId)!) : item);
    }
    for (const snapshot of lastResourceOrder.orders) {
      const saved = () => setResourceOrderHistory((history) => history.flatMap((entry) => {
        if (entry.id !== lastResourceOrder.id) return [entry];
        const orders = entry.orders.filter((order) => order !== snapshot);
        return orders.length || entry.restoreResources?.length ? [{ ...entry, orders }] : [];
      }));
      if (!snapshot.itemIds.length) { saved(); continue; }
      const currentOrder = sortGrindingPlanningBoardItems(restoredItems.filter((item) => !item.isCompleted &&
        (resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定') === snapshot.resourceCd), registeredFseibans, 'resource', allocation);
      const laneTests = tests.bars.filter((item) => item.resourceCd === snapshot.resourceCd && !item.isCompleted && !item.deletedAt);
      const mixedOrder: GrindingPlanningBoardBar[] = [...currentOrder, ...laneTests];
      if (laneTests.length) mixedOrder.sort(comparePlanningBoardBarOrder);
      const visibleIds = new Set(mixedOrder.filter((item) => item.kind === 'test' || isVisibleByArrival(item, arrivalFilterEnabled)).map((item) => item.itemId));
      const itemIds = arrivalFilterEnabled
        ? mergeVisibleResourceOrder(mixedOrder.map((item) => item.itemId), snapshot.itemIds.filter((itemId) => visibleIds.has(itemId))) : snapshot.itemIds;
      if (!enqueueResourceOrder({ ...snapshot, itemIds }, '順番を戻す', saved, undefined, undefined, restoredItems))
        notify('対象の工程が変わったため順番を戻せません。表示を確認してください。', 'error');
    }
  };
  return {
    focusItems, gantt, orderActionsDisabled, ganttLayout, lastResourceOrder, handleOrderScan,
    moveResourceInGantt, sortResourceOrdersByDue, proposeResourceOrder: () => proposeResourceOrder(), applyResourceOrder, togglePin, undoResourceOrder,
    changeOrderMethod: (method: UnitOrderMethod) => proposeResourceOrder(method, orderPreview)
  };
}
