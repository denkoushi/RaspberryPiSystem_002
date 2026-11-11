import { GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS, GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useMachineSignalResourceUptime } from '../../../../api/hooks/machine-signal';
import { normalizeMachineName } from '../../productionSchedule/machineName';
import { usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';
import { useOfflineUptime } from '../offline/planningBoardOfflineQueries';
import { pageZoom } from '../pageZoom';
import { PlanningBoardPiecesContext } from '../PlanningBoardPiecePopover';
import { usePlanningBoardPlacementByPart, usePlanningBoardProcessChips } from '../planningBoardProcessChips';
import { compareProcessOrder } from '../sortGrindingPlanningBoardItems';
import { usePlanningBoardPaneOrder } from '../usePlanningBoardPaneOrder';

import { ganttResourceLabel } from './ganttResourceLabel';
import { PlanningBoardChainLinks } from './PlanningBoardChainLinks';
import { PlanningBoardChainStrip } from './PlanningBoardChainStrip';
import { PlanningBoardDragArrow } from './PlanningBoardDragArrow';
import { PlanningBoardForwardGanttRow } from './PlanningBoardForwardGanttRow';
import { PlanningBoardForwardLaterQueue } from './PlanningBoardForwardLaterQueue';
import { PlanningBoardForwardQueuePopover } from './PlanningBoardForwardQueuePopover';
import { ganttBarGeometry } from './planningBoardGanttGeometry';
import { dayLabel, dayToDate, jstDay, planningBoardVisibleBars } from './planningBoardGanttLayout';
import { GANTT_FORWARD_LABEL_WIDTH, GANTT_LABEL_WIDTH, PlanningBoardGanttRow, type PlanningBoardGanttRowProps } from './PlanningBoardGanttRow';
import { sharePlanningBoardGanttLayout } from './planningBoardGanttSharing';
import { PlanningBoardResourceMinutesSheet } from './PlanningBoardResourceMinutesSheet';
import { planningBoardSeibanColor } from './planningBoardSeibanColor';
import { PlanningBoardSeibanLegend } from './PlanningBoardSeibanLegend';
import { planningBoardSharedBottomInset, planningBoardSheetGeometry } from './planningBoardSheetGeometry';
import { PlanningBoardSingleResourceHead } from './PlanningBoardSingleResourceHead';
import { buildSingleResourceWindows, foldSingleResourceRow, singleResourceWindowTime } from './planningBoardSingleResourceWindows';
import { usePersistedPlanningBoardChainView } from './usePersistedPlanningBoardChainView';
import { usePlanningBoardGanttPan } from './usePlanningBoardGanttPan';
import { usePlanningBoardGanttWindow } from './usePlanningBoardGanttWindow';

import type { ForwardDragPreview, ForwardMove, ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { ForwardQueueHandle } from './PlanningBoardForwardQueuePopover';
import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';
import type { GanttBarLocation, GanttBarLocations } from './planningBoardSingleResourceWindows';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export type { PlanningBoardGanttHandle } from './planningBoardGanttViewTypes';
const EMPTY_SEIBAN_ORDER: readonly string[] = [];
const EMPTY_CHAIN: GanttBar[] = [];
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const GANTT_BOTTOM_GAP = 10;
// With a 2- or 4-day span a day is wide enough to show where the hours fall.
const HOUR_TICKS = [8, 17, 20];
// The one-day scale fits six hours on screen so short jobs stay readable, with a tick every hour.
const ONE_DAY_VISIBLE_DAYS = 6 / 24;
const EVERY_HOUR = Array.from({ length: 24 }, (_, hour) => hour);
const SHIFT_START_HOUR = 8;
const HOUR_TICK_MIN_DAY_WIDTH = 160;
// The ‹ › buttons move the chart by two hours at any scale.
const NUDGE_DAYS = 2 / 24;

function laneAtPoint(x: number, y: number, resources: ReadonlySet<string>): HTMLElement | null {
  // Hit testing takes visual coordinates, just like pointer events.
  const elements = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
  for (const element of elements) {
    const lane = element.closest<HTMLElement>('[data-gantt-lane]');
    if (lane?.dataset.resourceCode && resources.has(lane.dataset.resourceCode)) return lane;
  }
  return null;
}

export const PlanningBoardGanttView = forwardRef<PlanningBoardGanttHandle, PlanningBoardGanttProps & { minutesResourceCds?: readonly string[] }>(function PlanningBoardGanttView({
  minutesResourceCds, resourceMinutesItems, resourceMinutes, minutesPending = false, minutesError = false, onMinutesSourceChange, valueSheetOpen = false, onToggleValueSheet,
  resourceLanes: _resourceLanes, unitSplitEnabledByResource, onUnitSplitChange, unitSplitAvailable, capacityLoaded: _capacityLoaded, machineSelectionLocked, machineSelectionLabel, resourceHeadContainer, valueSheetContainer, sharedValueSheetOpen = false, hideResourceHead = false, machineMode, twoMachineDisabled, onMachineModeChange, chainOwner, onChainFocus, sharedChainTop, sharedChainHeight = 0, onChainTopChange, machineModeButtonRef,
  onSelectedBarResource, fitPane = false, onNavigateBar, singleResourceCd = null, singleResourcePickerOpen = false, onOpenSingleResourcePicker, onSingleResourceChange,
  layout: currentLayout, scale, homeKey = 0, dailyHoursByResource, resourceNameMap, capacityPending, capacityError, onCapacityChange, runsThroughBreaks, onBreaksChange,
  focusedSeiban, onFocusedSeibanChange: setFocusedSeiban, sharedSeibanLegend = false, onCompleteToggle, completionPendingItemIds,
  colorBySeiban = false, seibanOrder = EMPTY_SEIBAN_ORDER, preferenceScope = 'default', ...interaction
}, ref) {
  const { enabled: offlineEnabled } = usePlanningBoardOffline(); const useUptime = offlineEnabled ? useOfflineUptime : useMachineSignalResourceUptime;
  const uptime = useUptime(currentLayout.mode === 'forward'); const previousUptime = useRef<ReadonlyMap<string, number>>(new Map());
  const uptimeByResource = useMemo(() => {
    const next = new Map(uptime.data?.resources.map((entry) =>
      [normalizeMachineName(entry.resourceCd), entry.medianRunSeconds]));
    const previous = previousUptime.current;
    return next.size === previous.size && [...next].every(([key, value]) => previous.has(key) && Object.is(previous.get(key), value))
      ? previous : next;
  }, [uptime.data]);
  useLayoutEffect(() => { previousUptime.current = uptimeByResource; }, [uptimeByResource]);
  const incomingChips = usePlanningBoardProcessChips();
  const incomingPlacements = usePlanningBoardPlacementByPart();
  const previousDetails = useRef({ chips: incomingChips, placements: incomingPlacements });
  // Drag previews re-render this view on every pointer move; compare contents only when a context map changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- previousDetails is a ref read only to keep the prior identity.
  const chipsByPart = useMemo(() => JSON.stringify([...incomingChips]) === JSON.stringify([...previousDetails.current.chips]) ? previousDetails.current.chips : incomingChips, [incomingChips]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- previousDetails is a ref read only to keep the prior identity.
  const placementByPart = useMemo(() => JSON.stringify([...incomingPlacements]) === JSON.stringify([...previousDetails.current.placements])
    ? previousDetails.current.placements : incomingPlacements, [incomingPlacements]);
  useLayoutEffect(() => { previousDetails.current = { chips: chipsByPart, placements: placementByPart }; }, [chipsByPart, placementByPart]);
  const previousLayout = useRef<GanttLayout | null>(null);
  const sourceLayout = useMemo(() => currentLayout.mode === 'forward' ? sharePlanningBoardGanttLayout(previousLayout.current, currentLayout) : currentLayout, [currentLayout]);
  useLayoutEffect(() => { previousLayout.current = sourceLayout; }, [sourceLayout]);
  // Stable row handlers must still see current callbacks and acknowledgement revisions.
  const currentBars = useMemo(() => new Map(currentLayout.groups.flatMap((group) => group.rows.flatMap((row) =>
    row.bars.map((bar) => [bar.item.itemId, bar] as const)))), [currentLayout]);
  const latest = useRef({ interaction, currentBars, onSelectedBarResource });
  useLayoutEffect(() => { latest.current = { interaction, currentBars, onSelectedBarResource }; });
  const parentPieceActions = useContext(PlanningBoardPiecesContext);
  const pieceActions = useMemo(() => {
    if (!parentPieceActions) return null;
    const item = (original: GrindingPlanningBoardItem) => latest.current.currentBars.get(original.itemId)?.item ?? original;
    return {
      ...parentPieceActions,
      onSplit: (original: GrindingPlanningBoardItem, quantities: number[]) => parentPieceActions.onSplit(item(original), quantities),
      onMerge: (items: GrindingPlanningBoardItem[]) => parentPieceActions.onMerge(items.map(item))
    };
  }, [parentPieceActions]);
  const pendingMove = useRef<{ id: string; layout: GanttLayout } | null>(null);
  useEffect(() => {
    const pending = pendingMove.current;
    if (!pending || currentLayout === pending.layout) return;
    const signature = (value: GanttLayout) => JSON.stringify([value.forwardQueue?.map((bar) => bar.item.itemId), value.groups.flatMap((group) => group.rows.flatMap((row) => row.bars.map((bar) => [bar.item.itemId, bar.resource, bar.start, bar.end])))]);
    if (signature(currentLayout) === signature(pending.layout)) return;
    pendingMove.current = null;
    for (const element of document.querySelectorAll<HTMLElement>(`[data-testid="planning-gantt-bar-${pending.id}"], [data-testid^="planning-gantt-bar-${pending.id}-segment-"], [data-testid="planning-forward-queue-card-${pending.id}"]`)) {
      element.animate?.([{ outline: '4px solid rgb(52 211 153)', outlineOffset: '2px' }, { outline: '4px solid transparent', outlineOffset: '6px' }], { duration: 850 });
    }
  }, [currentLayout]);
  const markMoved = (id: string) => {
    const pending = { id, layout: latestLayout.current };
    pendingMove.current = pending;
    // A save that never changes the layout must not flash on a later refresh.
    setTimeout(() => { if (pendingMove.current === pending) pendingMove.current = null; }, 10_000);
  };
  const latestLayout = useRef(currentLayout);
  useLayoutEffect(() => { latestLayout.current = currentLayout; }, [currentLayout]);
  const rowActions = useMemo(() => {
    const item = (original: GrindingPlanningBoardItem) => latest.current.currentBars.get(original.itemId)?.item ?? original;
    return {
      onToggleItem: (original: GrindingPlanningBoardItem, selected: boolean, resource?: string) => {
        if (selected && resource) latest.current.onSelectedBarResource?.(resource);
        latest.current.interaction.onToggleItem(item(original), selected);
      },
      onTogglePin: (original: GrindingPlanningBoardItem) => latest.current.interaction.onTogglePin?.(item(original)),
      onResourceReorder: ((original, target, placement) => { markMoved(original.itemId); latest.current.interaction.onResourceReorder?.(item(original), item(target), placement); }) as ForwardReorder,
      onResourceMove: ((original, resource, target, placement) => { markMoved(original.itemId); latest.current.interaction.onResourceMove?.(item(original), resource, target && item(target), placement); }) as ForwardMove,
      canMoveResource: (original: GrindingPlanningBoardItem, resource: string) => latest.current.interaction.canMoveResource?.(item(original), resource) ?? false
    };
  }, []);
  // Dragging a machine name up or down reorders the lanes; the order is kept on this kiosk only.
  const nextResources = sourceLayout.groups.every((group) => group.resource) ? sourceLayout.groups.map((group) => group.resource!) : [];
  const previousResources = useRef(nextResources);
  const laneResources = nextResources.length === previousResources.current.length && nextResources.every((resource, index) => resource === previousResources.current[index])
    ? previousResources.current : nextResources;
  useLayoutEffect(() => { previousResources.current = laneResources; }, [laneResources]);
  const laneAt = useCallback((x: number, y: number) => laneAtPoint(x, y, new Set(laneResources)), [laneResources]);
  const laneOrder = usePlanningBoardPaneOrder(laneResources, preferenceScope, laneAt, Boolean(interaction.disabled), { startOnMove: true });
  const layout = useMemo(() => laneResources.length < 2 ? sourceLayout : { ...sourceLayout,
    // With both 研削 and 切削 shown, lanes move only within their own heading.
    groups: [...sourceLayout.groups].sort((a, b) => (a.category === 'cutting' ? 1 : 0) - (b.category === 'cutting' ? 1 : 0)
      || laneOrder.order.indexOf(a.resource!) - laneOrder.order.indexOf(b.resource!)) },
  [sourceLayout, laneResources, laneOrder.order]);
  const previousRowSelections = useRef(new Map<string, ReadonlySet<string>>());
  const rowSelections = useMemo(() => new Map(layout.groups.flatMap((group) => group.rows.map((row) => {
    const next = new Set(row.bars.filter((bar) => interaction.selectedItemIds.has(bar.item.itemId)).map((bar) => bar.item.itemId));
    const previous = previousRowSelections.current.get(row.key);
    const selected = next.size === 0 ? EMPTY_SELECTION
      : previous && next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
    return [row.key, selected] as const;
  }))), [layout, interaction.selectedItemIds]);
  useLayoutEffect(() => { previousRowSelections.current = rowSelections; }, [rowSelections]);
  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown } = laneOrder;
  const laneHandle = useCallback((resource: string, text: string, className: string) => <button type="button" title={text}
    className={clsx('touch-none select-none truncate text-left focus-visible:outline focus-visible:outline-emerald-300', className)}
    disabled={interaction.disabled} aria-label={`資源CD ${resource}の行を並べ替え`}
    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => onPointerDown(event, resource)} onPointerMove={onPointerMove}
    onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onLostPointerCapture={onPointerCancel}
    onKeyDown={(event) => onKeyDown(event, resource)}>{text}</button>, [interaction.disabled, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown]);
  const [completionTargetId, setCompletionTargetId] = useState<string | null>(null);
  useEffect(() => {
    if (completionTargetId && !planningBoardVisibleBars(layout).some((bar) => bar.item.itemId === completionTargetId)) setCompletionTargetId(null);
  }, [completionTargetId, layout]);
  const toggleCompletionTarget = useCallback((itemId: string) => {
    setCompletionTargetId((current) => current === itemId ? null : itemId);
  }, []);
  const forward = layout.mode === 'forward';
  const resourceGroup = singleResourceCd ? layout.groups.find((group) => group.resource === singleResourceCd) : undefined;
  const singleGroup = forward ? resourceGroup : undefined;
  const showResourceHead = Boolean(singleGroup || (fitPane && resourceGroup));
  const singleMode = Boolean(singleGroup);
  const singleItems = useMemo(() => {
    const items = resourceMinutesItems ?? resourceGroup?.rows.flatMap((row) => row.bars.map((bar) => bar.item)) ?? [];
    return [...new Map(items.filter((item) => minutesResourceCds ? minutesResourceCds.includes(item.effectiveResourceCd ?? item.originalResourceCd ?? '') : (item.effectiveResourceCd ?? item.originalResourceCd) === singleResourceCd)
      .map((item) => [item.itemId, item])).values()];
  }, [resourceMinutesItems, resourceGroup, singleResourceCd, minutesResourceCds]);
  const singleHours = dailyHoursByResource[singleResourceCd ?? ''] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS;
  const singlePauses = !runsThroughBreaks?.has(singleResourceCd ?? '');
  const [viewportWidth, setViewportWidth] = useState(1120);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const labelWidth = forward ? GANTT_FORWARD_LABEL_WIDTH : GANTT_LABEL_WIDTH;
  const dayWidth = Math.max(1, viewportWidth - labelWidth) / (scale === 1 ? ONE_DAY_VISIBLE_DAYS : scale);
  const foldedWindows = useMemo(() => singleGroup ? buildSingleResourceWindows(layout.today,
    Math.min(layout.end, Math.max(layout.today + 3, ...singleGroup.rows.flatMap((row) => row.bars.map((bar) => Math.ceil(bar.end ?? layout.today) + 1)))),
    scale, singleHours, singlePauses).filter((window) => window.end > (layout.now ?? -Infinity) + 1e-9) : [], [singleGroup, layout.today, layout.end, layout.now, scale, singleHours, singlePauses]);
  const foldedRows = useMemo(() => new Map(singleGroup?.rows.flatMap((row) => foldedWindows.map((window) => {
    const folded = foldSingleResourceRow(row, window, dayWidth);
    return [folded.key, { row: folded, window }] as const;
  })) ?? []), [singleGroup, foldedWindows, dayWidth]);
  // The scheduler still sees every resource. Only these render rows are folded/filtered.
  const renderedGroups = useMemo(() => singleGroup ? [{ ...singleGroup, rows: [...foldedRows.values()].map(({ row }) => row) }] : layout.groups,
    [singleGroup, foldedRows, layout.groups]);
  const barLocations = useMemo<GanttBarLocations>(() => {
    const result = new Map<string, { first: GanttBarLocation; last: GanttBarLocation }>();
    for (const group of renderedGroups) for (const row of group.rows) for (const bar of row.bars) {
      const location = { rowKey: row.key, bar, start: foldedRows.get(row.key)?.window.start ?? layout.start };
      const previous = result.get(bar.item.itemId);
      result.set(bar.item.itemId, { first: previous?.first ?? location, last: location });
    }
    return result;
  }, [renderedGroups, foldedRows, layout.start]);
  const incomingColors = useMemo(() => {
    if (!colorBySeiban) return undefined;
    const seibans = [...new Set(planningBoardVisibleBars(layout).map((bar) => bar.item.fseiban))];
    // The legend follows the left pane's seiban priority; seibans outside it keep their first-seen order at the end.
    const rank = (seiban: string) => { const index = seibanOrder.indexOf(seiban); return index < 0 ? seibanOrder.length : index; };
    seibans.sort((a, b) => rank(a) - rank(b));
    return new Map(seibans.map((seiban) => [seiban, planningBoardSeibanColor(seiban, seibanOrder)] as const));
  }, [colorBySeiban, layout, seibanOrder]);
  const previousColors = useRef(incomingColors);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- previousColors is a ref read only to keep the prior identity.
  const seibanColors = useMemo(() => JSON.stringify([...(incomingColors ?? [])]) === JSON.stringify([...(previousColors.current ?? [])]) && Boolean(incomingColors) === Boolean(previousColors.current)
    ? previousColors.current : incomingColors, [incomingColors]);
  useLayoutEffect(() => { previousColors.current = seibanColors; }, [seibanColors]);
  useEffect(() => {
    if (!sharedSeibanLegend && focusedSeiban !== null && !seibanColors?.has(focusedSeiban)) setFocusedSeiban(null);
  }, [focusedSeiban, seibanColors, setFocusedSeiban, sharedSeibanLegend]);
  useEffect(() => {
    if (focusedSeiban === null) return;
    const clear = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"], [data-planning-board-popover], [data-forward-queue], [data-planning-board-value-sheet]')) setFocusedSeiban(null); };
    document.addEventListener('keydown', clear);
    return () => document.removeEventListener('keydown', clear);
  }, [focusedSeiban, setFocusedSeiban]);
  const legend = useRef<HTMLDivElement>(null);
  const [legendHeight, setLegendHeight] = useState(0);
  const chainStrip = useRef<HTMLDivElement>(null);
  const [chainStripHeight, setChainStripHeight] = useState(0);
  const { frozen } = usePlanningBoardOffline();
  const [dragPreview, setDragPreview] = useState<ForwardDragPreview | null>(null);
  const dragLanes = useMemo(() => renderedGroups.flatMap((group) => group.resource
    ? singleGroup ? group.rows.map((row) => ({ resource: group.resource!, bars: row.bars, rowKey: row.key,
      start: foldedRows.get(row.key)!.window.start, end: foldedRows.get(row.key)!.window.end }))
      : [{ resource: group.resource, bars: group.rows.flatMap((row) => row.bars) }] : []), [renderedGroups, singleGroup, foldedRows]);
  const latestDragLanes = useRef(dragLanes);
  useLayoutEffect(() => { latestDragLanes.current = dragLanes; }, [dragLanes]);
  const queuePopover = useRef<ForwardQueueHandle>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const startPan = usePlanningBoardGanttPan();
  const content = useRef<HTMLDivElement>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const registerRow = useCallback((key: string, element: HTMLDivElement | null) => {
    if (element) rowElements.current.set(key, element); else rowElements.current.delete(key);
  }, []);
  const barRows = useMemo(() => new Map([...barLocations].map(([id, locations]) => [id, locations.first.rowKey])), [barLocations]);
  const [focusedPartKey, setFocusedPartKey] = useState<string | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const chain = useMemo(() => forward && focusedPartKey ? layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars))
    .filter((bar) => bar.partKey === focusedPartKey)
    .sort((a, b) => compareProcessOrder(a.item.processOrder, b.item.processOrder) || (a.item.piecePosition ?? Infinity) - (b.item.piecePosition ?? Infinity) || a.item.itemId.localeCompare(b.item.itemId)) : EMPTY_CHAIN, [forward, layout, focusedPartKey]);
  const { view: chainView, changeView: changeChainView } = usePersistedPlanningBoardChainView();
  const hasPieceLinks = useMemo(() => {
    const parents = new Set<string>();
    return chain.some(({ item }) => {
      if (item.kind !== 'piece' || !item.parentItemId) return false;
      if (parents.has(item.parentItemId)) return true;
      parents.add(item.parentItemId);
      return false;
    });
  }, [chain]);
  const effectiveChainView = hasPieceLinks ? chainView : 'process';
  const chainPositions = useMemo(() => {
    const positions = new Map<string, number>();
    return new Map(chain.map(({ item }) => {
      const key = item.kind === 'piece' && item.parentItemId ? item.parentItemId : item.itemId;
      if (!positions.has(key)) positions.set(key, positions.size + 1);
      return [item.itemId, positions.get(key)!];
    }));
  }, [chain]);
  const showChain = chain.length > 0 && !interaction.pinMode && (chainOwner === undefined || chainOwner === singleResourceCd);
  useEffect(() => {
    if (!showChain) { setFocusedPartKey(null); setCurrentItemId(null); }
  }, [showChain]);
  useLayoutEffect(() => {
    const element = chainStrip.current;
    if (!showChain || !element) return;
    const measure = () => setChainStripHeight(element.offsetHeight);
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [showChain, valueSheetContainer]);
  const valueSheet = showResourceHead && valueSheetOpen ? <PlanningBoardResourceMinutesSheet key={singleResourceCd} resourceCd={singleResourceCd!} resourceCds={minutesResourceCds} resourceNameMap={resourceNameMap} items={singleItems} unitSplitEnabledByResource={unitSplitEnabledByResource}
    values={resourceMinutes?.values ?? []} disabled={interaction.disabled || !resourceMinutes || singleResourceCd === '未設定'} /> : null;
  const [sharedBounds, setSharedBounds] = useState({ height: 0, top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const pane = viewport.current;
    if (!valueSheetContainer || !pane) return;
    const measure = () => {
      const containerRect = valueSheetContainer.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      const zoom = pageZoom();
      const next = { height: valueSheetContainer.clientHeight,
        top: (paneRect.top - containerRect.top) / zoom, bottom: (paneRect.bottom - containerRect.top) / zoom };
      setSharedBounds(current => current.height === next.height && current.top === next.top && current.bottom === next.bottom ? current : next);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(valueSheetContainer);
    observer?.observe(pane);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [valueSheetContainer]);
  const sheetHeight = valueSheetOpen && showResourceHead ? Math.min(((viewportHeight ?? 0) + 40) * 0.56, 520) : 0;
  const sharedGeometry = planningBoardSheetGeometry(sharedBounds.height, sharedBounds.top, sharedBounds.bottom,
    sharedValueSheetOpen, showChain ? chainStripHeight : 0);
  const chainTop = sharedBounds.height - sharedGeometry.chainBottom - chainStripHeight;
  useLayoutEffect(() => {
    if (!singleResourceCd || !onChainTopChange) return;
    onChainTopChange(singleResourceCd, showChain ? chainTop : null, chainStripHeight);
    return () => onChainTopChange(singleResourceCd, null, 0);
  }, [singleResourceCd, onChainTopChange, showChain, chainTop, chainStripHeight]);
  const sharedBottomInset = sharedChainTop == null ? sharedGeometry.bottomInset : planningBoardSharedBottomInset(sharedBounds.top, sharedBounds.bottom, sharedGeometry.sheetOverlap, sharedChainTop, sharedChainHeight);
  const bottomInset = valueSheetContainer ? sharedBottomInset : (showChain ? chainStripHeight : 0) + sheetHeight;
  const focusChain = useCallback((bar: GanttBar, keepOpen = false) => {
    if (singleResourceCd) onChainFocus?.(singleResourceCd);
    setFocusedPartKey((current) => keepOpen || current !== bar.partKey ? bar.partKey : null);
    setCurrentItemId(null);
  }, [onChainFocus, singleResourceCd]);
  const showQueue = useCallback((bar: GanttBar, anchor: HTMLButtonElement) => {
    if (!showChain && !queuePopover.current?.isPinned()) queuePopover.current?.show(latest.current.currentBars.get(bar.item.itemId) ?? bar, anchor);
  }, [showChain]);
  const leaveQueue = useCallback(() => queuePopover.current?.hideSoon(), []);
  const closeQueue = useCallback(() => queuePopover.current?.closeUnlessPinned(), []);
  const flaggedIndex = useRef(-1);
  const previousSingleKey = useRef<string | null>(null); const previousAxis = useRef<{ start: number; dayWidth: number; scale: number; forward: boolean; homeKey: number; step: number; today: number } | null>(null);
  const width = singleGroup ? Math.max(1, viewportWidth - labelWidth) : (layout.end - layout.start) * dayWidth;
  const { window: ganttWindow, onScroll: updateWindow, measure: measureWindow } = usePlanningBoardGanttWindow(viewport, labelWidth);
  const showHours = dayWidth >= HOUR_TICK_MIN_DAY_WIDTH;
  const hourTicks = scale === 1 ? EVERY_HOUR : HOUR_TICKS;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Fill the screen down to the bottom edge instead of guessing the height of the chrome above.
    const measure = () => {
      measureWindow();
      if (element.clientWidth > 0) setViewportWidth(element.clientWidth);
      const top = element.getBoundingClientRect().top;
      setLegendHeight(legend.current?.offsetHeight ?? 0);
      if (fitPane) setViewportHeight(element.clientHeight);
      else if (window.innerHeight > 0) setViewportHeight(Math.max(192, Math.floor((window.innerHeight - top) / pageZoom() - GANTT_BOTTOM_GAP - (legend.current?.offsetHeight ?? 0))));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (legend.current) observer?.observe(legend.current);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [colorBySeiban, singleResourceCd, measureWindow, fitPane]);
  // Before paint, so the mounted window follows the new position without a blank frame.
  useLayoutEffect(() => {
    if (!viewport.current) return;
    // 1台表示: only a new machine or scale returns to the first row, not the 30-second clock tick.
    const singleKey = singleMode ? `${singleResourceCd}:${scale}:${forward}:${homeKey}` : null; if (singleKey) { if (previousSingleKey.current !== singleKey) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; } previousSingleKey.current = singleKey; measureWindow(); return; }
    previousSingleKey.current = null; const previous = previousAxis.current;
    // A scale press starts near today so a 2- or 4-day span does not open on past days; data changes keep the position.
    // The one-day scale never opens before the shift starts. Backward charts open an hour before now on the hour.
    // 「今日から」 has nothing before now, so it opens ten minutes before the current ten-minute step and keeps the bars at the left edge.
    // Each new step also returns to that position, so an unattended board keeps following the clock.
    const nowMinute = ((layout.now ?? jstDay(new Date())) - layout.today) * 24 * 60;
    const stepMinutes = forward && scale === 1 ? 10 : 60;
    // Day fractions lose a little precision, so 14:00 can come out as 13:59.99…; the epsilon keeps it in the new step.
    const step = Math.floor(nowMinute / stepMinutes + 1e-6);
    const homeMinute = forward ? step * stepMinutes - 10 : (step - 1) * stepMinutes;
    const home = layout.today + (scale === 1 ? Math.max(SHIFT_START_HOUR * 60, homeMinute) / (24 * 60) : forward || scale < 7 ? 0 : -3);
    const firstDay = previous && previous.scale === scale && previous.forward === forward && previous.homeKey === homeKey && previous.step === step && previous.today === layout.today
      ? previous.start + viewport.current.scrollLeft / previous.dayWidth
      : home;
    viewport.current.scrollLeft = Math.max(0, (firstDay - layout.start) * dayWidth);
    previousAxis.current = { start: layout.start, dayWidth, scale, forward, homeKey, step, today: layout.today };
    measureWindow();
  }, [dayWidth, layout.start, layout.today, layout.now, scale, forward, homeKey, measureWindow, singleResourceCd, singleMode]);
  const nudge = (direction: 1 | -1) => {
    if (viewport.current) viewport.current.scrollLeft = Math.max(0, viewport.current.scrollLeft + direction * NUDGE_DAYS * dayWidth);
  };
  const days = useMemo(() => Array.from({ length: layout.end - layout.start }, (_, i) => {
    const day = layout.start + i;
    const weekday = new Date(day * 86_400_000).getUTCDay();
    return { day, weekday, weekend: weekday === 0 || weekday === 6 };
  }), [layout.end, layout.start]);
  const dateHeadings = useMemo(() => days.map(({ day, weekday, weekend }) => <div key={day} className={clsx('relative shrink-0 overflow-hidden whitespace-nowrap border-l border-slate-800 pt-0.5 text-center text-[11px] leading-4 tabular-nums', day === layout.today ? 'bg-emerald-400 font-bold text-slate-950' : weekend ? 'bg-slate-800 text-slate-300' : 'text-slate-300')}
              style={{ width: dayWidth }} title={dayToDate(day)}>
              {dayWidth >= 44 || weekday === 1 ? `${dayLabel(day)} ` : ''}{WEEKDAYS[weekday]}
              {showHours && hourTicks.map((hour) => <span key={hour} className="absolute bottom-0 -translate-x-1/2 text-xs font-bold leading-4 opacity-90" style={{ left: `${hour / 24 * 100}%` }}>{hour}時</span>)}
            </div>), [days, dayWidth, layout.today, showHours, hourTicks]);
  const selectedParts = useMemo(() => new Set(layout.groups.flatMap((group) => group.rows.flatMap((row) =>
    row.bars.filter((bar) => interaction.selectedItemIds.has(bar.item.itemId)).map((bar) => bar.partKey)
  ))), [interaction.selectedItemIds, layout]);
  const scrollToBar = useCallback((bar: GanttBar) => {
    const element = viewport.current;
    const rowElement = rowElements.current.get(barRows.get(bar.item.itemId)!);
    const location = barLocations.get(bar.item.itemId)?.first;
    const rect = ganttBarGeometry(location?.bar ?? bar, location?.start ?? layout.start, dayWidth, forward, false, singleMode);
    if (!element || !rowElement || !rect) return false;
    const bounds = element.getBoundingClientRect();
    // Centre the first segment, keeping its start visible when wider than the chart.
    const barLeft = labelWidth + rect.left;
    const left = Math.max(0, Math.min(barLeft + rect.width / 2 - (viewportWidth + labelWidth) / 2, barLeft - labelWidth - 16));
    const rowTop = (rowElement.getBoundingClientRect().top - bounds.top) / pageZoom() + rect.top;
    const visibleHeight = element.clientHeight || viewportHeight || bounds.height / pageZoom();
    const top = Math.max(0, element.scrollTop + rowTop - 36,
      element.scrollTop + rowTop + rect.height - visibleHeight + bottomInset);
    if (typeof element.scrollTo === 'function') element.scrollTo({ left, top, behavior: 'smooth' });
    else { element.scrollLeft = left; element.scrollTop = top; }
    return true;
  }, [barRows, barLocations, layout.start, dayWidth, forward, singleMode, labelWidth, viewportWidth, viewportHeight, bottomInset]);
  useImperativeHandle(ref, () => ({ scrollToItem: (itemId) => { const bar = currentBars.get(itemId); return bar ? scrollToBar(bar) : false; }, scrollToNextOverlap: () => {
    const element = viewport.current;
    const rows = layout.groups.flatMap((group) => group.rows).filter((row) => row.flagged);
    if (!element || !rows.length) return;
    flaggedIndex.current = (flaggedIndex.current + 1) % rows.length;
    const row = rows[flaggedIndex.current]!;
    const rowElement = rowElements.current.get(row.key);
    if (!rowElement) return;
    element.scrollTop += (rowElement.getBoundingClientRect().top - element.getBoundingClientRect().top) / pageZoom() - 36;
    const rect = row.bars.map((bar) => ganttBarGeometry(bar, layout.start, dayWidth, forward)).find((rect) => rect !== null);
    if (rect) element.scrollLeft = Math.max(0, rect.left - (viewportWidth - labelWidth) / 2);
    measureWindow();
  }, scrollToNextLate: () => {
    const element = viewport.current;
    const bars = forward ? planningBoardVisibleBars(layout).filter((bar) => bar.tone === 'late' && (!singleGroup || barLocations.has(bar.item.itemId))) : [];
    if (!element || !bars.length) return;
    flaggedIndex.current = (flaggedIndex.current + 1) % bars.length;
    const bar = bars[flaggedIndex.current]!;
    const location = barLocations.get(bar.item.itemId)?.first;
    const rect = ganttBarGeometry(location?.bar ?? bar, location?.start ?? layout.start, dayWidth, forward, false, singleMode);
    const rowElement = rowElements.current.get(barRows.get(bar.item.itemId)!);
    if (!rowElement || !rect) return;
    element.scrollTop += (rowElement.getBoundingClientRect().top - element.getBoundingClientRect().top) / pageZoom() + rect.top - 70;
    element.scrollLeft = Math.max(0, rect.left - (viewportWidth - labelWidth) / 2);
    measureWindow();
  } }), [currentBars, scrollToBar, layout, forward, dayWidth, viewportWidth, labelWidth, barRows, barLocations, measureWindow, singleGroup, singleMode]);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!pendingJump || !barLocations.has(pendingJump)) return;
    const bar = currentBars.get(pendingJump);
    if (bar) scrollToBar(bar);
    setPendingJump(null);
  }, [pendingJump, barLocations, currentBars, scrollToBar]);
  const scrollToStep = (bar: GanttBar) => {
    if (!machineSelectionLocked && singleGroup && bar.resource !== singleResourceCd && !onNavigateBar?.(bar)) { onSingleResourceChange?.(bar.resource); setPendingJump(bar.item.itemId); }
    else scrollToBar(bar);
    setCurrentItemId(bar.item.itemId);
  };
  // A legend chip jumps to the seiban's earliest bar; late-star dates pass their row's starred bars to stay on that machine.
  const focusSeiban = (seiban: string, itemIds?: readonly string[]) => {
    setFocusedSeiban(seiban);
    const barStart = (bar: GanttBar) => bar.segments?.[0]?.start ?? bar.start ?? bar.end ?? Infinity;
    const candidates = planningBoardVisibleBars(layout).filter((bar) => bar.item.fseiban === seiban && (!singleGroup || bar.resource === singleResourceCd));
    const first = [candidates.filter((bar) => itemIds?.includes(bar.item.itemId)), candidates].find((bars) => bars.length)?.reduce<GanttBar | undefined>((earliest, bar) => !earliest || barStart(bar) < barStart(earliest) ? bar : earliest, undefined);
    if (first) scrollToBar(first);
  };
  // Rows are memoized, so the late-star date buttons get one stable callback that reads the latest focus.
  const toggleSeibanLatest = useRef<NonNullable<PlanningBoardGanttRowProps['onToggleSeiban']>>((seiban, itemIds) => { if (focusedSeiban === seiban) setFocusedSeiban(null); else focusSeiban(seiban, itemIds); });
  useLayoutEffect(() => { toggleSeibanLatest.current = (seiban, itemIds) => { if (focusedSeiban === seiban) setFocusedSeiban(null); else focusSeiban(seiban, itemIds); }; });
  const toggleSeiban = useCallback<NonNullable<PlanningBoardGanttRowProps['onToggleSeiban']>>((seiban, itemIds) => toggleSeibanLatest.current(seiban, itemIds), []);
  const breaksButton = useCallback((resource: string) => <button type="button"
    className={clsx('h-7 w-9 shrink-0 whitespace-nowrap rounded border px-0 text-[13px] font-bold leading-none disabled:opacity-40',
      !runsThroughBreaks?.has(resource) ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
    aria-pressed={!runsThroughBreaks?.has(resource)}
    aria-disabled={frozen || undefined} disabled={resource === '未設定' || dailyHoursByResource[resource] === 24 || capacityPending || interaction.disabled}
    onClick={() => onBreaksChange?.(resource, !runsThroughBreaks?.has(resource))}>休憩</button>, [frozen, runsThroughBreaks, dailyHoursByResource, capacityPending, interaction.disabled, onBreaksChange]);
  const resourceLabel = useCallback((resource: string, label: string) => <>
    {laneHandle(resource, ganttResourceLabel(normalizeMachineName(label), resourceNameMap[resource]), 'min-h-5 font-bold')}
    {resourceMinutes?.ownSourceResourceCds.includes(resource) && <span className="rounded bg-amber-400/15 px-1 text-[10px] font-bold text-amber-300">独自</span>}
    <div className="flex gap-1" role="group" aria-label={`${resource}の1日の稼働時間`}>
      {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((hours) => <button key={hours} type="button"
        className={clsx('h-7 w-8 shrink-0 rounded border px-0 font-mono text-[13px] font-bold leading-none',
          (dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
        aria-pressed={(dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours}
        aria-disabled={frozen || undefined} disabled={resource === '未設定' || capacityPending || interaction.disabled}
        onClick={() => onCapacityChange(resource, hours)}>{hours}H</button>)}
      {breaksButton(resource)}
    </div>
    {uptimeByResource.has(normalizeMachineName(resource)) && <div className="flex h-4 items-center gap-1.5 whitespace-nowrap leading-4" title="稼働した日の1日あたり稼働時間の中央値">
      <span className="text-[12px] font-bold text-slate-300">月平均</span>
      <span className="font-mono text-[15px] font-bold tabular-nums text-emerald-300">{(uptimeByResource.get(normalizeMachineName(resource))! / 3600).toFixed(1)}h</span>
    </div>}
  </>, [frozen, resourceMinutes, laneHandle, resourceNameMap, dailyHoursByResource, capacityPending, interaction.disabled, onCapacityChange, breaksButton, uptimeByResource]);
  const previousLabels = useRef<{ render: typeof resourceLabel; labels: Map<string, { text: string; node: React.ReactNode }> } | null>(null);
  const resourceLabels = useMemo(() => new Map(layout.groups.filter((group) => group.resource).map((group) => {
    const old = previousLabels.current?.render === resourceLabel ? previousLabels.current.labels.get(group.resource!) : undefined;
    return [group.resource!, old?.text === group.label ? old : { text: group.label, node: resourceLabel(group.resource!, group.label) }];
  })), [layout.groups, resourceLabel]);
  useLayoutEffect(() => { previousLabels.current = { render: resourceLabel, labels: resourceLabels }; }, [resourceLabel, resourceLabels]);
  const resourceHead = showResourceHead && !hideResourceHead ? <PlanningBoardSingleResourceHead machineModeButtonRef={machineModeButtonRef} machineSelectionLocked={machineSelectionLocked} machineSelectionLabel={machineSelectionLabel} machineMode={machineMode} twoMachineDisabled={twoMachineDisabled} onMachineModeChange={onMachineModeChange} resourceCd={singleResourceCd!} names={resourceNameMap[singleResourceCd!]}
        unitSplitEnabledByResource={unitSplitEnabledByResource} onUnitSplitChange={onUnitSplitChange} unitSplitAvailable={unitSplitAvailable?.(singleResourceCd!)}
        resourceCds={minutesResourceCds} items={singleItems} minutes={resourceMinutes} minutesPending={minutesPending} sheetOpen={valueSheetOpen} onToggleSheet={() => onToggleValueSheet?.(singleResourceCd ?? undefined)}
        onSourceChange={(source) => {
          for (const resourceCd of minutesResourceCds ?? [singleResourceCd!]) {
            if (!minutesResourceCds || (resourceMinutes?.ownSourceResourceCds.includes(resourceCd) ?? false) !== (source === 'own')) onMinutesSourceChange?.({ resourceCd, source });
          }
        }}
        hours={singleHours} pausesForBreaks={singlePauses} averageSeconds={uptimeByResource.get(normalizeMachineName(singleResourceCd!))}
        disabled={singleResourceCd === '未設定' || capacityPending || interaction.disabled} pickerOpen={singleResourcePickerOpen}
        onOpenPicker={onOpenSingleResourcePicker} onCapacityChange={onCapacityChange} onBreaksChange={onBreaksChange} /> : null;
  const chainStripView = <PlanningBoardChainStrip selectedItemIds={interaction.selectedItemIds} ref={chainStrip} bottom={valueSheetContainer ? sharedGeometry.chainBottom : legendHeight + sheetHeight} bars={chain} resourceNameMap={resourceNameMap} currentItemId={currentItemId}
        onCompleteToggle={onCompleteToggle} completionPendingItemIds={completionPendingItemIds} pieceDisabled={interaction.pieceDisabled} disabled={interaction.disabled}
        chainView={effectiveChainView} onChainViewToggle={hasPieceLinks ? () => changeChainView(chainView === 'pieces' ? 'process' : 'pieces') : undefined}
        onStep={scrollToStep} onClose={() => setFocusedPartKey(null)} />;
  return (
    <PlanningBoardPiecesContext.Provider value={pieceActions}>
    <section aria-label="製番ボード ガント" data-testid="planning-board-gantt" className={clsx('relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900', fitPane ? 'flex h-full min-h-0 flex-col' : 'mt-2')}>
      {minutesError && <p role="alert" className="absolute right-0 top-10 z-[70] bg-slate-950 px-2 py-1 text-xs text-rose-200">所要時間を保存・取得できませんでした。</p>}
      {capacityError && <p role="alert" className="absolute right-0 top-0 z-40 px-2 py-1 text-xs text-rose-200">稼働時間を保存できませんでした。</p>}
      {resourceHead && (resourceHeadContainer === null ? null : resourceHeadContainer ? createPortal(resourceHead, resourceHeadContainer) : resourceHead)}
      <div ref={viewport} data-gantt-viewport onScroll={() => { queuePopover.current?.closeUnlessPinned(); updateWindow(); }} className={clsx('relative overflow-auto', fitPane ? 'min-h-0 flex-1 overscroll-contain' : 'min-h-48')}
        style={{ height: fitPane ? undefined : viewportHeight ?? undefined, overflowAnchor: 'none', scrollPaddingBottom: `${bottomInset}px` }} tabIndex={0} aria-label="ガントの日付と工程"
        onPointerDown={startPan}
        onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}>
        <div ref={content} className="relative isolate" style={{ width: labelWidth + width, paddingBottom: bottomInset }}>
          {!singleGroup && <div className="sticky top-0 z-30 flex h-9 border-b border-slate-700 bg-slate-950">
            {/* The ‹ › buttons sit in the top-left corner so they never cover bars. */}
            <div className="sticky left-0 z-40 flex shrink-0 items-center justify-center gap-2 bg-slate-950 px-2" style={{ width: labelWidth }} role="group" aria-label="ガントの左右送り">
              {([[-1, '2時間戻る', '‹'], [1, '2時間進む', '›']] as const).map(([direction, label, mark]) => <button key={direction} type="button" aria-label={label}
                className="grid h-8 w-16 place-items-center rounded-md border border-slate-500 bg-slate-900 pb-0.5 text-2xl font-bold leading-none text-slate-100 active:bg-sky-400 active:text-slate-950"
                onClick={() => nudge(direction)}>{mark}</button>)}
            </div>
            {dateHeadings}
          </div>}
          {/* The forward chart draws no vertical grid so the brighter row lines carry the eye from the machine name to its bars. */}
          {!forward && days.map(({ day, weekend }) => <div key={day} className={clsx('pointer-events-none absolute bottom-0 top-9 border-l border-slate-800/70', weekend && 'bg-slate-950/50')}
            style={{ left: labelWidth + (day - layout.start) * dayWidth, width: dayWidth }} />)}
          {!forward && showHours && days.flatMap(({ day }) => hourTicks.map((hour) => <div key={`${day}-${hour}`} className="pointer-events-none absolute bottom-0 top-9 border-l border-dashed border-slate-700/60"
            style={{ left: labelWidth + (day - layout.start + hour / 24) * dayWidth }} />))}
          {!forward && <div className="pointer-events-none absolute bottom-0 top-9 z-[1] w-px bg-emerald-400" style={{ left: labelWidth + (layout.today - layout.start) * dayWidth }} />}
          {layout.completedOnly && <p className="sticky left-0 w-fit p-3 text-sm text-slate-400">完了は「納期から」で表示</p>}
          {renderedGroups.map((group, index) => <div key={group.key} data-gantt-lane={group.resource ? '' : undefined} data-resource-code={group.resource ?? undefined}
            data-gantt-lane-resource={group.resource ?? undefined}
            style={{ opacity: dragPreview && group.resource && !dragPreview.allowed.has(group.resource) ? 0.3 : undefined,
              outline: dragPreview?.drop?.resource === group.resource && group.resource !== dragPreview?.bar.resource ? '3px solid rgb(110 231 183)' : undefined,
              outlineOffset: -3 }}>
            {!singleGroup && interaction.resourceView && group.category && group.category !== layout.groups[index - 1]?.category && (
              <div data-testid="planning-gantt-category-header" className="relative flex h-6 bg-slate-800 text-[11px] font-bold">
                <div className="sticky left-0 z-20 flex items-center bg-slate-800 px-2" style={{ width: labelWidth }}>
                  {group.category === 'grinding' ? '研削' : '切削'}
                </div>
              </div>
            )}
            {!(forward && group.resource) && <div className="relative flex min-h-11 border-b border-slate-700 bg-slate-800">
              <div data-gantt-lane-label className="sticky left-0 z-20 flex min-h-11 shrink-0 items-center gap-1 bg-slate-800 px-2 text-xs" style={{ width: labelWidth }}>
                {group.resource ? laneHandle(group.resource, ganttResourceLabel(normalizeMachineName(group.label), resourceNameMap[group.resource]), 'min-h-11 min-w-0 flex-1 font-bold')
                  : <strong className="min-w-0 flex-1 truncate" title={group.label}>{normalizeMachineName(group.label)}</strong>}
                {group.resource && resourceMinutes?.ownSourceResourceCds.includes(group.resource) && <span className="rounded bg-amber-400/15 px-1 text-[10px] font-bold text-amber-300">独自</span>}
                {group.resource && group.resource !== '未設定' && <div className="flex shrink-0 gap-1" role="group" aria-label={`${group.resource}の1日の稼働時間`}>
                  {GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.map((hours) => <button key={hours} type="button"
                    className={clsx('h-7 w-8 shrink-0 rounded border px-0 font-mono text-[13px] font-bold leading-none',
                      (dailyHoursByResource[group.resource!] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 bg-slate-900 text-slate-200')}
                    aria-pressed={(dailyHoursByResource[group.resource!] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) === hours}
                    aria-disabled={frozen || undefined} disabled={capacityPending || interaction.disabled}
                    onClick={() => onCapacityChange(group.resource!, hours)}>{hours}H</button>)}
                  {breaksButton(group.resource)}
                </div>}
              </div>
            </div>}
            <div className="relative">
            {forward ? group.rows.map((row) => {
              const folded = foldedRows.get(row.key);
              const rowStart = folded?.window.start ?? layout.start;
              const rowEnd = folded?.window.end ?? layout.end;
              return <PlanningBoardForwardGanttRow foldedWindow={folded?.window} window={ganttWindow} registerRow={registerRow} seibanColors={seibanColors} focusedSeiban={focusedSeiban} onToggleSeiban={seibanColors ? toggleSeiban : undefined} key={row.key} row={row} chipsByPart={chipsByPart} placementByPart={placementByPart} start={rowStart} end={rowEnd} today={layout.today} now={folded ? layout.now! >= folded.window.start && layout.now! < folded.window.end ? singleResourceWindowTime(folded.window, layout.now!) : NaN : layout.now!} width={width} dayWidth={dayWidth} scale={scale}
                onShowQueue={showQueue} onLeaveQueue={leaveQueue} onCloseQueue={closeQueue}
                pausesForBreaks={group.resource ? !runsThroughBreaks?.has(group.resource) : row.bars.some((bar) => !runsThroughBreaks?.has(bar.resource))}
                hours={group.resource ? dailyHoursByResource[group.resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS : Math.max(...row.bars.map((bar) => dailyHoursByResource[bar.resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS), GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS)}
                selectedItemIds={folded ? interaction.selectedItemIds : rowSelections.get(row.key) ?? EMPTY_SELECTION} disabled={interaction.disabled} dragDisabled={interaction.dragDisabled}
                pinMode={interaction.pinMode} resourceView={interaction.resourceView} {...rowActions}
                lanes={latestDragLanes}
                draggedItemId={dragPreview && row.bars.some((bar) => bar.item.itemId === dragPreview.bar.item.itemId) ? dragPreview.bar.item.itemId : null}
                insertionLeft={dragPreview?.drop && dragPreview.drop.resource === group.resource && (!folded || dragPreview.drop.rowKey === row.key) ? dragPreview.drop.left : null} onDragPreview={setDragPreview}
                focusedPartKey={showChain ? focusedPartKey : null} chainPositions={chainPositions} onFocusChain={focusChain}
                label={folded ? undefined : group.resource ? resourceLabels.get(group.resource)?.node : undefined} />;
            }) : group.rows.map((row) => <PlanningBoardGanttRow window={ganttWindow} registerRow={registerRow} seibanColors={seibanColors} focusedSeiban={focusedSeiban} onToggleSeiban={seibanColors ? toggleSeiban : undefined} key={row.key} row={row} start={layout.start} width={width} dayWidth={dayWidth}
              showPieceQuantity={layout.mode !== 'forward'} completionTargetId={completionTargetId} onCompletionTarget={toggleCompletionTarget} onCompleteToggle={onCompleteToggle} completionPendingItemIds={completionPendingItemIds}
              today={dayToDate(layout.today)} selectedParts={selectedParts} {...interaction} />)}
            {forward && !singleGroup && group.resource && <div data-later-queue-host={`column-${dragLanes.findIndex((lane) => lane.resource === group.resource)}`}
              className="pointer-events-none absolute inset-0 flex items-stretch justify-end" />}
            </div>
          </div>)}
          {forward && !singleGroup && <PlanningBoardForwardLaterQueue viewport={viewport} lanes={dragLanes} start={layout.start} dayWidth={dayWidth}
            labelWidth={labelWidth} viewportWidth={viewportWidth}
            onOpen={(bar, anchor) => queuePopover.current?.show(bar, anchor, true)} />}
          {showChain && <PlanningBoardChainLinks view={effectiveChainView} barLocations={barLocations} bars={chain} content={content} rowElements={rowElements} barRows={barRows} labelWidth={labelWidth} layout={layout} dayWidth={dayWidth} viewportWidth={viewportWidth} viewportHeight={viewportHeight} />}
        </div>
      </div>
      {showChain && (valueSheetContainer ? createPortal(chainStripView, valueSheetContainer) : chainStripView)}
      {!sharedSeibanLegend && seibanColors && <PlanningBoardSeibanLegend ref={legend} seibanColors={seibanColors}
        focusedSeiban={focusedSeiban} onFocusedSeibanChange={setFocusedSeiban} onFocusSeiban={focusSeiban} />}
      {forward && <PlanningBoardForwardQueuePopover ref={queuePopover} folded={Boolean(singleGroup)} layout={currentLayout} scale={scale} resourceNameMap={resourceNameMap} {...interaction} viewport={viewport} lanes={dragLanes} start={layout.start} dayWidth={dayWidth} labelWidth={labelWidth} viewportWidth={viewportWidth} onDragPreview={setDragPreview} draggedItemId={dragPreview?.bar.item.itemId ?? null} onResourceReorder={rowActions.onResourceReorder} onResourceMove={rowActions.onResourceMove} dragDisabled={interaction.dragDisabled || Boolean(interaction.pinMode)} />}
      {valueSheet && (valueSheetContainer === null ? null : valueSheetContainer ? createPortal(valueSheet, valueSheetContainer) : valueSheet)}
      {dragPreview && <PlanningBoardDragArrow preview={dragPreview} viewport={viewport} />}
      {dragPreview && createPortal(<div data-testid="planning-gantt-drag-ghost"
        className="pointer-events-none fixed z-[110] scale-105 rounded shadow-2xl border-2 border-amber-400 bg-slate-950 px-2 py-1 text-[13px] text-slate-100"
        style={{ left: dragPreview.x / pageZoom() + 12, top: dragPreview.y / pageZoom() + 12 }}>
        <strong className="font-mono">{dragPreview.bar.resource}</strong> {dragPreview.bar.item.fhinmei || dragPreview.bar.item.fhincd}
      </div>, document.body)}
    </section>
    </PlanningBoardPiecesContext.Provider>
  );
});
