import { useMemo } from 'react';

import { planningBoardAutoOrder, planningBoardLaneOrder, planningBoardOrderMetrics } from './gantt/planningBoardAutoOrder';
import { buildForwardPlanningBoardGanttLayout, planningBoardVisibleBars } from './gantt/planningBoardGanttLayout';
import { usePlanningBoardGantt } from './gantt/usePlanningBoardGantt';
import { applyOptimisticOverride, EMPTY_ORDER, todayJst } from './planningBoardPageModel';
import { compareProcessOrder, resolveGrindingPlanningBoardDueDate, resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';

import type { GanttLayoutOptions } from './gantt/planningBoardGanttLayout';
import type { FeedbackKind, OrderPreview, ResourceOrderHistory, ResourceOrderSnapshot } from './planningBoardPageModel';
import type { PlanningBoardAllocation } from './types';
import type { usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';
import type { useUpdateKioskGrindingPlanningBoardPins, useUpdateKioskGrindingPlanningBoardResourceOrderBulk } from '../../../api/hooks';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardItem, GrindingPlanningBoardOverrideItemRequest, GrindingPlanningBoardResourceOrderPlacement, GrindingPlanningBoardResponse, GrindingPlanningBoardView } from '@raspi-system/shared-types';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type Options = {
  focusedFseiban: string | null;
  sortedItemsBySeiban: Map<string, GrindingPlanningBoardItem[]>;
  view: GrindingPlanningBoardView;
  visibleItems: GrindingPlanningBoardItem[];
  nowMs: number;
  ganttEnabled: boolean;
  allocation: PlanningBoardAllocation;
  category: GrindingPlanningBoardCategory;
  data: GrindingPlanningBoardResponse | undefined;
  registeredFseibans: string[];
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
  focusedFseiban, sortedItemsBySeiban, view, visibleItems, nowMs, ganttEnabled, allocation, category,
  data, registeredFseibans, bulkReady, rankMutationReady, writeBlocked, writeQueue, orderPreview,
  resourceOrderHistory, historyScope, currentItemsRef, hasPendingSeiban, enqueueWrite, updateResourceOrderBulkAsync,
  setColorBySeiban, setFocusedFseiban, setOpenFseibans, setFocusedSeiban, setScanFocusKey, setScanNotice,
  scopeReady, pinMode, canMoveResource, snapshotResourceOrder, notify, resourceOrderHistoryId, enqueueOverrides,
  setResourceOrderHistory, rememberResourceOrder, setPinMode, setOrderPreview, sourceRevision, rankConflict,
  orderConflict, updatePinsAsync
}: Options) {
  const focusItems = useMemo(
    () => focusedFseiban ? sortedItemsBySeiban.get(focusedFseiban) ?? [] : [],
    [focusedFseiban, sortedItemsBySeiban]
  );
  const ganttItems = useMemo(() => view === 'seiban' && focusedFseiban && focusItems.length > 0
    ? focusItems : visibleItems, [view, focusedFseiban, focusItems, visibleItems]);
  const ganttNow = useMemo(() => new Date(nowMs), [nowMs]);
  const gantt = usePlanningBoardGantt({ enabled: ganttEnabled, items: ganttItems, allocation, view, category, resourceCategories: data?.resourceCategories,
    seibanOrder: registeredFseibans, resources: data?.resources ?? EMPTY_ORDER,
    today: todayJst(), now: ganttNow, preferenceScope: `${data?.siteKey ?? ''}:${category}` });
  const orderActionsDisabled = !bulkReady || !rankMutationReady || writeBlocked || writeQueue.pending || gantt.capacityPending;
  const ganttLayout = useMemo(() => orderPreview
    ? buildForwardPlanningBoardGanttLayout({ ...orderPreview.options, scale: gantt.scale, laneOrder: orderPreview.proposal })
    : gantt.layout, [orderPreview, gantt.scale, gantt.layout]);
  const lastResourceOrder = resourceOrderHistory.filter((entry) => entry.scope === historyScope).at(-1);
  const enqueueResourceOrder = (snapshot: ResourceOrderSnapshot, label: string, onSaved: () => void, preview?: OrderPreview, onFailed?: () => void,
    sourceItems = preview?.options.items ?? currentItemsRef.current) => {
    const items = snapshot.itemIds.map((id) => sourceItems.find((item) => item.itemId === id));
    if (!items.length || items.length > 500 || items.some((item) => !item || item.isCompleted ||
      (resolveGrindingPlanningBoardResource(item, 'alternate') ?? '未設定') !== snapshot.resourceCd || hasPendingSeiban(item.fseiban, true))) return false;
    const members = items as GrindingPlanningBoardItem[];
    const ranks = new Map(snapshot.itemIds.map((id, index) => [id, index + 1]));
    return enqueueWrite({ label, itemIds: snapshot.itemIds, seibans: [...new Set(members.map((item) => item.fseiban))], order: true,
      apply: (display) => ({ ...display, items: display.items.map((item) => ranks.has(item.itemId) ? { ...item, alternateRank: ranks.get(item.itemId)! } : item) }),
      save: (context) => updateResourceOrderBulkAsync({ sourceRevision: preview?.sourceRevision ?? context.sourceRevision, resourceCd: snapshot.resourceCd,
        items: members.map((original) => { const item = context.item(original); return { itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version }; }) }),
      onSaved, onFailed
    });
  };
  const handleOrderScan = (productNo: string): string | null => {
    const displayedItems = ganttEnabled
      ? planningBoardVisibleBars(ganttLayout).map((bar) => bar.item)
      : view === 'seiban' && focusedFseiban && focusItems.length > 0 ? focusItems : visibleItems;
    const item = displayedItems.find((candidate) => candidate.productNo === productNo);
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
        restoreResource: { itemId: item.itemId, resourceCd: previousResource } }].slice(-10));
    } })) return;
    // A resource change clears alternateRank. Queue the complete destination order after its override acknowledgement.
    if (sameBand) enqueueResourceOrder({ resourceCd: targetResource, itemIds: proposed }, '資源CDと順番', () => {}, undefined, undefined,
      currentItemsRef.current.map((candidate) => candidate.itemId === item.itemId ? applyOptimisticOverride(candidate, request) : candidate));
  };
  const sortResourceOrdersByDue = () => {
    if (gantt.mode !== 'forward' || allocation !== 'alternate' || orderActionsDisabled) return;
    const id = ++resourceOrderHistoryId.current;
    const resources = [...new Set(ganttItems.filter((item) => !item.isCompleted).map((item) => resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定'))];
    for (const resourceCd of resources) {
      const visible = sortGrindingPlanningBoardItems(ganttItems.filter((item) => !item.isCompleted &&
        (resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定') === resourceCd), registeredFseibans, 'resource', allocation);
      const sorted = [...visible].sort((a, b) => {
        if (a.specialDue || b.specialDue) return a.specialDue ? b.specialDue ? 0 : -1 : 1;
        return (resolveGrindingPlanningBoardDueDate(a, allocation) ?? '9999-12-31').localeCompare(resolveGrindingPlanningBoardDueDate(b, allocation) ?? '9999-12-31') ||
          compareProcessOrder(a.processOrder, b.processOrder) || a.itemId.localeCompare(b.itemId);
      });
      if (sorted.every((item, index) => item.itemId === visible[index]!.itemId)) continue;
      const before = snapshotResourceOrder(resourceCd);
      if (!enqueueResourceOrder({ resourceCd, itemIds: sorted.map((item) => item.itemId) }, '納期順', () => rememberResourceOrder(id, before))) {
        notify('並べ替える対象は資源ごとに500件までです。表示を確認してください。', 'error');
      }
    }
  };
  const proposeResourceOrder = () => {
    if (gantt.mode !== 'forward' || view !== 'resource' || allocation !== 'alternate' || orderActionsDisabled) return;
    const options: GanttLayoutOptions = { items: ganttItems, allocation, view, category, resourceCategories: data?.resourceCategories,
      seibanOrder: registeredFseibans, resources: data?.resources ?? EMPTY_ORDER, dailyHoursByResource: gantt.dailyHoursByResource, runsThroughBreaks: gantt.runsThroughBreaks,
      today: todayJst(), scale: gantt.scale, now: ganttNow };
    const current = planningBoardLaneOrder(options);
    const proposal = planningBoardAutoOrder(options, new Set(ganttItems.filter((item) => item.orderPinned).map((item) => item.itemId)));
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
    if (!orderPreview || writeQueue.pending || writeQueue.blocked || rankConflict || orderConflict) return;
    const preview = orderPreview;
    const changed = Object.keys(preview.proposal).filter((resource) => preview.proposal[resource]!.some((id, index) => id !== preview.current[resource]?.[index]));
    const id = ++resourceOrderHistoryId.current;
    let remaining = changed.length;
    for (const resourceCd of changed) {
      const before = { resourceCd, itemIds: preview.current[resourceCd]! };
      if (!enqueueResourceOrder({ resourceCd, itemIds: preview.proposal[resourceCd]! }, '並べ替え', () => {
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
    if (!pinMode || orderActionsDisabled || original.isCompleted) return;
    const item = currentItemsRef.current.find((candidate) => candidate.itemId === original.itemId);
    if (!item) return;
    const pinned = !item.orderPinned;
    enqueueWrite({ label: pinned ? '固定' : '固定の解除', itemIds: [item.itemId], seibans: [item.fseiban],
      apply: (display) => ({ ...display, items: display.items.map((entry) => entry.itemId === item.itemId ? { ...entry, orderPinned: pinned } : entry) }),
      save: (context) => { const current = context.item(item); return updatePinsAsync({ sourceRevision: context.sourceRevision, pinned,
        items: [{ itemId: current.itemId, itemRevision: current.itemRevision, overrideVersion: current.version }] }); }
    });
  };
  const undoResourceOrder = () => {
    if (gantt.mode !== 'forward' || allocation !== 'alternate' || orderActionsDisabled || !lastResourceOrder) return;
    let restoredItems = currentItemsRef.current;
    if (lastResourceOrder.restoreResource) {
      const restore = lastResourceOrder.restoreResource;
      const item = restoredItems.find((candidate) => candidate.itemId === restore.itemId);
      if (!item || item.isCompleted) { notify('対象の工程が変わったため移動を戻せません。表示を確認してください。', 'error'); return; }
      const request = { ...restore, itemRevision: item.itemRevision, overrideVersion: item.version };
      if (!enqueueOverrides([item], [request], '資源CDを戻す', undefined, undefined, { onSaved: () => {
        setResourceOrderHistory((history) => history.map((entry) => entry.id === lastResourceOrder.id ? { ...entry, restoreResource: undefined } : entry));
      } })) return;
      restoredItems = restoredItems.map((candidate) => candidate.itemId === item.itemId ? applyOptimisticOverride(candidate, request) : candidate);
    }
    for (const snapshot of lastResourceOrder.orders) {
      const saved = () => setResourceOrderHistory((history) => history.flatMap((entry) => {
        if (entry.id !== lastResourceOrder.id) return [entry];
        const orders = entry.orders.filter((order) => order !== snapshot);
        return orders.length || entry.restoreResource ? [{ ...entry, orders }] : [];
      }));
      if (!snapshot.itemIds.length) { saved(); continue; }
      if (!enqueueResourceOrder(snapshot, '順番を戻す', saved, undefined, undefined, restoredItems))
        notify('対象の工程が変わったため順番を戻せません。表示を確認してください。', 'error');
    }
  };
  return {
    focusItems, gantt, orderActionsDisabled, ganttLayout, lastResourceOrder, handleOrderScan,
    moveResourceInGantt, sortResourceOrdersByDue, proposeResourceOrder, applyResourceOrder, togglePin, undoResourceOrder
  };
}
