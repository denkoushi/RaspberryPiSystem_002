import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';


import {
  INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX
} from '../../part-measurement/inspection-drawing/inspectionDrawingCanvasPointer';
import { formatResourceCdWithJapaneseNames } from '../leaderOrderBoard/formatResourceCdWithJapaneseNames';

import { PlanningBoardItemTable } from './PlanningBoardItemTable';
import { resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';
import { usePlanningBoardPaneOrder } from './usePlanningBoardPaneOrder';

import type { PlanningBoardAllocation } from './types';
import type {
  GrindingPlanningBoardItem,
  GrindingPlanningBoardResourceOrderPlacement,
  GrindingPlanningBoardSpecialDueKind
} from '@raspi-system/shared-types';

export type PlanningBoardResourceViewProps = {
  items: readonly GrindingPlanningBoardItem[];
  seibanOrder: readonly string[];
  resources: readonly string[];
  resourceNameMap: Record<string, string[]>;
  preferenceScope?: string;
  allocation: PlanningBoardAllocation;
  selectedItemIds: ReadonlySet<string>;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onResourceDrop?: (item: GrindingPlanningBoardItem, resourceCd: string) => void;
  onResourceReorder?: (
    item: GrindingPlanningBoardItem,
    targetItem: GrindingPlanningBoardItem,
    placement: GrindingPlanningBoardResourceOrderPlacement
  ) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  specialDueMode?: GrindingPlanningBoardSpecialDueKind | null;
  onSpecialDueClick?: (item: GrindingPlanningBoardItem) => void;
  nowMs?: number;
  disabled?: boolean;
  resourceDragDisabled?: boolean;
  rankDisabled?: boolean | ((item: GrindingPlanningBoardItem) => boolean);
};

type PendingResourceDrag = {
  pointerId: number;
  item: GrindingPlanningBoardItem;
  sourceResource: string | null;
  buttonElement: HTMLButtonElement;
  startClientX: number;
  startClientY: number;
  maxMovementPx: number;
  dragging: boolean;
  ghostElement: HTMLDivElement | null;
  ghostOffsetX: number;
  ghostOffsetY: number;
  pendingClientX: number;
  pendingClientY: number;
  frameId: number | null;
  dropPaneElement: HTMLElement | null;
  dropPaneOriginalOutline: string;
  dropPaneOriginalOutlineOffset: string;
  dropRowElement: HTMLElement | null;
  dropRowOriginalBorderTop: string;
  dropRowOriginalBorderBottom: string;
  originalButtonOpacity: string;
};

const RESOURCE_PANE_SELECTOR = '[data-planning-board-resource-pane]';

function specialDueBand(item: GrindingPlanningBoardItem): string | null {
  return item.specialDue?.expiresAt ?? null;
}

function resourcePaneAtPoint(
  clientX: number,
  clientY: number,
  validResources: ReadonlySet<string>
): HTMLElement | null {
  const elements = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(clientX, clientY)
    : typeof document.elementFromPoint === 'function'
      ? [document.elementFromPoint(clientX, clientY)].filter((element): element is Element => element != null)
      : [];
  for (const element of elements) {
    if (!(element instanceof Element)) continue;
    const pane = element.closest<HTMLElement>(RESOURCE_PANE_SELECTOR);
    const resourceCode = pane?.dataset.resourceCode;
    if (pane && resourceCode && validResources.has(resourceCode)) return pane;
  }
  return null;
}

function restoreDropRow(drag: PendingResourceDrag): void {
  if (!drag.dropRowElement) return;
  drag.dropRowElement.style.borderTop = drag.dropRowOriginalBorderTop;
  drag.dropRowElement.style.borderBottom = drag.dropRowOriginalBorderBottom;
  drag.dropRowElement = null;
}

function setDropRow(
  drag: PendingResourceDrag,
  row: HTMLElement | null,
  placement: GrindingPlanningBoardResourceOrderPlacement | null
): void {
  restoreDropRow(drag);
  if (!row || placement == null) return;
  drag.dropRowElement = row;
  drag.dropRowOriginalBorderTop = row.style.borderTop;
  drag.dropRowOriginalBorderBottom = row.style.borderBottom;
  if (placement === 'before') row.style.borderTop = '2px solid rgb(110 231 183)';
  else row.style.borderBottom = '2px solid rgb(110 231 183)';
}

function itemRowAtPoint(clientX: number, clientY: number, pane: HTMLElement): HTMLElement | null {
  const elements = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(clientX, clientY)
    : typeof document.elementFromPoint === 'function'
      ? [document.elementFromPoint(clientX, clientY)].filter((element): element is Element => element != null)
      : [];
  for (const element of elements) {
    if (!(element instanceof Element)) continue;
    const row = element.closest<HTMLElement>('[data-planning-board-item-id]');
    if (row?.closest<HTMLElement>(RESOURCE_PANE_SELECTOR) === pane) return row;
  }
  return null;
}

export function PlanningBoardResourceView({
  items,
  seibanOrder,
  resources,
  resourceNameMap,
  preferenceScope = 'default',
  allocation,
  selectedItemIds,
  onToggleItem,
  onResourceClick,
  onResourceDrop,
  onResourceReorder,
  onRankChange,
  specialDueMode = null,
  onSpecialDueClick,
  nowMs,
  disabled = false,
  resourceDragDisabled = false,
  rankDisabled = false
}: PlanningBoardResourceViewProps) {
  const pendingResourceDragRef = useRef<PendingResourceDrag | null>(null);
  const suppressedResourceClickPointerIdRef = useRef<number | null>(null);
  const validResources = useMemo(() => new Set(resources), [resources]);

  const cancelResourceDragFrame = useCallback((drag: PendingResourceDrag) => {
    if (drag.frameId === null) return;
    window.cancelAnimationFrame(drag.frameId);
    drag.frameId = null;
  }, []);

  const restoreDropPane = useCallback((drag: PendingResourceDrag) => {
    restoreDropRow(drag);
    if (!drag.dropPaneElement) return;
    drag.dropPaneElement.style.outline = drag.dropPaneOriginalOutline;
    drag.dropPaneElement.style.outlineOffset = drag.dropPaneOriginalOutlineOffset;
    drag.dropPaneElement = null;
  }, []);

  const setDropPane = useCallback((drag: PendingResourceDrag, pane: HTMLElement | null) => {
    if (drag.dropPaneElement === pane) return;
    restoreDropPane(drag);
    if (!pane) return;
    drag.dropPaneElement = pane;
    drag.dropPaneOriginalOutline = pane.style.outline;
    drag.dropPaneOriginalOutlineOffset = pane.style.outlineOffset;
    pane.style.outline = '2px solid rgb(110 231 183)';
    pane.style.outlineOffset = '-2px';
  }, [restoreDropPane]);

  const flushResourceDragFrame = useCallback(() => {
    const drag = pendingResourceDragRef.current;
    if (!drag) return;
    drag.frameId = null;
    if (!drag.ghostElement) return;
    drag.ghostElement.style.transform =
      'translate3d(' + (drag.pendingClientX - drag.ghostOffsetX) + 'px, ' +
      (drag.pendingClientY - drag.ghostOffsetY) + 'px, 0)';
    const pane = resourcePaneAtPoint(
      drag.pendingClientX,
      drag.pendingClientY,
      validResources
    );
    setDropPane(drag, pane);
    if (pane?.dataset.resourceCode !== (drag.sourceResource ?? '未設定')) {
      setDropRow(drag, null, null);
      return;
    }
    const row = itemRowAtPoint(drag.pendingClientX, drag.pendingClientY, pane);
    const targetItem = row == null
      ? null
      : items.find((candidate) => candidate.itemId === row.dataset.planningBoardItemId) ?? null;
    const sameSpecialDueBand = targetItem == null || specialDueBand(targetItem) === specialDueBand(drag.item);
    const placement = row == null || targetItem == null || targetItem.itemId === drag.item.itemId || targetItem.isCompleted
      || !sameSpecialDueBand
      ? null
      : drag.pendingClientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
        ? 'before'
        : 'after';
    setDropRow(drag, row, placement);
  }, [items, setDropPane, validResources]);

  const scheduleResourceDragFrame = useCallback(() => {
    const drag = pendingResourceDragRef.current;
    if (!drag || drag.frameId !== null) return;
    drag.frameId = window.requestAnimationFrame(flushResourceDragFrame);
  }, [flushResourceDragFrame]);

  const createResourceDragGhost = useCallback((drag: PendingResourceDrag) => {
    if (drag.ghostElement) return;
    const rect = drag.buttonElement.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.textContent = drag.sourceResource ?? '—';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.className = 'pointer-events-none fixed z-[70] inline-flex min-h-11 items-center justify-center rounded-md border border-indigo-300 bg-slate-900 px-2 font-mono text-[15px] font-bold text-white shadow-lg';
    ghost.style.pointerEvents = 'none';
    ghost.style.left = '0';
    ghost.style.top = '0';
    ghost.style.width = rect.width + 'px';
    ghost.style.minWidth = Math.max(rect.width, 44) + 'px';
    ghost.style.height = Math.max(rect.height, 44) + 'px';
    ghost.style.opacity = '0.96';
    drag.ghostOffsetX = Math.min(Math.max(0, drag.startClientX - rect.left), rect.width);
    drag.ghostOffsetY = Math.min(Math.max(0, drag.startClientY - rect.top), rect.height);
    document.body.appendChild(ghost);
    drag.ghostElement = ghost;
    drag.originalButtonOpacity = drag.buttonElement.style.opacity;
    drag.buttonElement.style.opacity = '0.35';
  }, []);

  const clearResourceDrag = useCallback((pointerId: number) => {
    const drag = pendingResourceDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return null;
    cancelResourceDragFrame(drag);
    restoreDropPane(drag);
    drag.buttonElement.style.opacity = drag.originalButtonOpacity;
    drag.ghostElement?.remove();
    pendingResourceDragRef.current = null;
    if (drag.buttonElement.hasPointerCapture?.(pointerId)) {
      try {
        drag.buttonElement.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    }
    return drag;
  }, [cancelResourceDragFrame, restoreDropPane]);

  useEffect(() => () => {
    const drag = pendingResourceDragRef.current;
    if (!drag) return;
    cancelResourceDragFrame(drag);
    restoreDropPane(drag);
    drag.buttonElement.style.opacity = drag.originalButtonOpacity;
    drag.ghostElement?.remove();
    if (drag.buttonElement.hasPointerCapture?.(drag.pointerId)) {
      try {
        drag.buttonElement.releasePointerCapture(drag.pointerId);
      } catch {
        /* already released */
      }
    }
    pendingResourceDragRef.current = null;
  }, [cancelResourceDragFrame, restoreDropPane]);

  useEffect(() => {
    const drag = pendingResourceDragRef.current;
    if (!drag) return;
    const sourceItem = items.find((item) => item.itemId === drag.item.itemId);
    const sourceChanged = sourceItem == null ||
      sourceItem.isCompleted ||
      sourceItem.itemRevision !== drag.item.itemRevision ||
      sourceItem.version !== drag.item.version ||
      resolveGrindingPlanningBoardResource(sourceItem, allocation) !== drag.sourceResource;
    if (sourceChanged || disabled || allocation === 'original' || resourceDragDisabled) {
      clearResourceDrag(drag.pointerId);
      suppressedResourceClickPointerIdRef.current = null;
    }
  }, [allocation, clearResourceDrag, disabled, items, resourceDragDisabled]);

  const handleResourcePointerDown = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    item: GrindingPlanningBoardItem,
    currentResource: string | null
  ) => {
    if (event.button !== 0 || pendingResourceDragRef.current) return;
    suppressedResourceClickPointerIdRef.current = null;
    const buttonElement = event.currentTarget;
    pendingResourceDragRef.current = {
      pointerId: event.pointerId,
      item,
      sourceResource: currentResource,
      buttonElement,
      startClientX: event.clientX,
      startClientY: event.clientY,
      maxMovementPx: 0,
      dragging: false,
      ghostElement: null,
      ghostOffsetX: 0,
      ghostOffsetY: 0,
      pendingClientX: event.clientX,
      pendingClientY: event.clientY,
      frameId: null,
      dropPaneElement: null,
      dropPaneOriginalOutline: '',
      dropPaneOriginalOutlineOffset: '',
      dropRowElement: null,
      dropRowOriginalBorderTop: '',
      dropRowOriginalBorderBottom: '',
      originalButtonOpacity: buttonElement.style.opacity
    };
    buttonElement.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
  }, []);

  const handleResourcePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = pendingResourceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.maxMovementPx = Math.max(
      drag.maxMovementPx,
      Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
    );
    if (!drag.dragging && drag.maxMovementPx < INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX) return;
    drag.dragging = true;
    createResourceDragGhost(drag);
    drag.pendingClientX = event.clientX;
    drag.pendingClientY = event.clientY;
    scheduleResourceDragFrame();
    event.preventDefault();
    event.stopPropagation();
  }, [createResourceDragGhost, scheduleResourceDragFrame]);

  const handleResourcePointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = pendingResourceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const isDrag = drag.dragging;
    const targetPane = isDrag
      ? resourcePaneAtPoint(event.clientX, event.clientY, validResources)
      : null;
    const targetResource = targetPane?.dataset.resourceCode ?? null;
    const item = drag.item;
    const sourceResource = drag.sourceResource ?? '未設定';
    const isSamePaneDrop = isDrag && targetPane != null && targetResource === sourceResource;
    const targetRow = isSamePaneDrop && targetPane
      ? itemRowAtPoint(event.clientX, event.clientY, targetPane)
      : null;
    const targetItem = targetRow == null
      ? null
      : items.find((candidate) => candidate.itemId === targetRow.dataset.planningBoardItemId) ?? null;
    const shouldReorder = isSamePaneDrop && targetItem != null && targetItem.itemId !== item.itemId && !targetItem.isCompleted && specialDueBand(targetItem) === specialDueBand(item);
    const shouldDrop = isDrag && targetResource != null && targetResource !== sourceResource;
    const placement = targetRow == null
      ? null
      : event.clientY < targetRow.getBoundingClientRect().top + targetRow.getBoundingClientRect().height / 2
        ? 'before'
        : 'after';
    if (isDrag) suppressedResourceClickPointerIdRef.current = event.pointerId;
    clearResourceDrag(event.pointerId);
    if (isDrag) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (shouldDrop) onResourceDrop?.(item, targetResource);
    else if (shouldReorder && placement != null) onResourceReorder?.(item, targetItem, placement);
  }, [clearResourceDrag, items, onResourceDrop, onResourceReorder, validResources]);

  const handleResourcePointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = pendingResourceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clearResourceDrag(event.pointerId);
    suppressedResourceClickPointerIdRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  }, [clearResourceDrag]);

  const handleResourceLostPointerCapture = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = pendingResourceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clearResourceDrag(event.pointerId);
    suppressedResourceClickPointerIdRef.current = null;
  }, [clearResourceDrag]);

  const handleResourceClick = useCallback((item: GrindingPlanningBoardItem) => {
    if (suppressedResourceClickPointerIdRef.current !== null) {
      suppressedResourceClickPointerIdRef.current = null;
      return;
    }
    onResourceClick(item);
  }, [onResourceClick]);

  const seibanRankByFseiban = useMemo(
    () => new Map(seibanOrder.map((fseiban, index) => [fseiban, index + 1] as const)),
    [seibanOrder]
  );
  const groups = useMemo(() => {
    const byResource = new Map<string, GrindingPlanningBoardItem[]>();
    for (const resource of resources) byResource.set(resource, []);
    for (const item of items) {
      const resource = resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定';
      const group = byResource.get(resource) ?? [];
      group.push(item);
      byResource.set(resource, group);
    }
    return [...byResource.entries()]
      .map(([resource, resourceItems]) => [
        resource,
        sortGrindingPlanningBoardItems(resourceItems, seibanOrder, 'resource', allocation)
      ] as const);
  }, [allocation, items, resources, seibanOrder]);

  const paneResources = useMemo(() => groups.map(([resource]) => resource), [groups]);
  const paneResourceSet = useMemo(() => new Set(paneResources), [paneResources]);
  const paneAtPoint = useCallback((x: number, y: number) => resourcePaneAtPoint(x, y, paneResourceSet), [paneResourceSet]);
  const paneOrder = usePlanningBoardPaneOrder(paneResources, preferenceScope, paneAtPoint, disabled);
  const groupsByResource = useMemo(() => new Map(groups), [groups]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<ReadonlyMap<string, { layer: number; height: number }>>(new Map());
  const topLayerRef = useRef(0);
  const [heights, setHeights] = useState({ normal: 361, expanded: 722 });
  const [bottomSpace, setBottomSpace] = useState(0);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let scrollParent = grid.parentElement;
    while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)) scrollParent = scrollParent.parentElement;
    const tables = [...grid.querySelectorAll<HTMLTableElement>('table')];
    const measure = () => {
      // Measure only the first seven rows, and leave short panes the same height.
      const bodyHeight = Math.max(315, ...tables.map((table) => {
        const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')].slice(0, 7);
        return rows.reduce((height, row) => height + row.getBoundingClientRect().height, 0) + (7 - rows.length) * 45;
      }));
      const normal = Math.ceil(bodyHeight) + 46;
      const expandedHeight = Math.max(normal, (scrollParent?.clientHeight || window.innerHeight) - 20);
      setHeights((current) => current.normal === normal && current.expanded === expandedHeight
        ? current : { normal, expanded: expandedHeight });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    tables.forEach((table) => observer?.observe(table));
    if (scrollParent) observer?.observe(scrollParent);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [groups]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const overflow = [...grid.children].reduce((space, slot) => {
      const resource = (slot as HTMLElement).dataset.resourceSlot;
      return resource && expanded.has(resource)
        ? Math.max(space, slot.getBoundingClientRect().top - gridRect.bottom + Math.max(heights.normal, Math.min(expanded.get(resource)!.height, heights.expanded)))
        : space;
    }, 0);
    setBottomSpace(Math.ceil(overflow));
  }, [expanded, heights, paneOrder.order]);

  const toggleExpanded = (resource: string, button: HTMLButtonElement) => {
    const opening = !expanded.has(resource);
    const layer = ++topLayerRef.current;
    const paneTop = button.closest('article')?.getBoundingClientRect().top ?? 0;
    const available = Math.min(heights.expanded, window.innerHeight - Math.max(0, paneTop) - 20);
    const needsScroll = available <= heights.normal;
    const height = needsScroll ? heights.expanded : available;
    setExpanded((current) => {
      const next = new Map(current);
      if (next.has(resource)) next.delete(resource); else next.set(resource, { layer, height });
      return next;
    });
    if (opening && needsScroll) {
      // Keep the symbol button reachable when opening a pane near the bottom.
      requestAnimationFrame(() => {
        if (button.isConnected) button.closest('article')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      });
    }
  };

  return (
    <div className="relative isolate min-w-0" style={{ paddingBottom: bottomSpace }}>
      <div ref={gridRef} className="relative grid min-w-0 grid-cols-1 items-start gap-2.5 lg:grid-cols-2 xl:grid-cols-4" data-testid="planning-board-resource-view">
        {paneOrder.order.map((resource) => {
          const resourceItems = groupsByResource.get(resource) ?? [];
          const isExpanded = expanded.has(resource);
          return (
            <div key={resource} className="relative min-w-0" data-resource-slot={resource} style={{ height: heights.normal, zIndex: expanded.get(resource)?.layer ?? 0 }}>
              <article
                className="absolute inset-x-0 top-0 flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
                style={{ height: isExpanded ? Math.max(heights.normal, Math.min(expanded.get(resource)!.height, heights.expanded)) : heights.normal }}
                data-planning-board-resource-pane
                data-resource-code={resource}
                data-expanded={isExpanded}
                onPointerDownCapture={() => {
                  if (!isExpanded) return;
                  const layer = ++topLayerRef.current;
                  setExpanded((current) => {
                    const pane = current.get(resource);
                    return pane ? new Map(current).set(resource, { ...pane, layer }) : current;
                  });
                }}
                onPointerMove={handleResourcePointerMove}
                onPointerUp={handleResourcePointerUp}
                onPointerCancel={handleResourcePointerCancel}
                onLostPointerCapture={handleResourceLostPointerCapture}
              >
                <header className="flex h-11 min-h-11 min-w-0 items-center border-b border-slate-800">
                  <button
                    type="button"
                    className="h-11 min-w-0 flex-1 touch-none select-none truncate px-2 text-left font-mono text-[15px] font-bold leading-none text-white focus-visible:outline focus-visible:outline-emerald-300"
                    disabled={disabled}
                    aria-label={`資源CD ${resource}のペインを並べ替え`}
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => paneOrder.onPointerDown(event, resource)}
                    onPointerMove={paneOrder.onPointerMove}
                    onPointerUp={paneOrder.onPointerUp}
                    onPointerCancel={paneOrder.onPointerCancel}
                    onLostPointerCapture={paneOrder.onPointerCancel}
                    onKeyDown={(event) => paneOrder.onKeyDown(event, resource)}
                  >
                    {formatResourceCdWithJapaneseNames(resource, resourceNameMap)}
                  </button>
                  <button
                    type="button"
                    className="h-11 w-11 shrink-0 text-2xl leading-none text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-emerald-300"
                    aria-label={`資源CD ${resource}を${isExpanded ? '縮小' : '拡張'}`}
                    aria-expanded={isExpanded}
                    onClick={(event) => toggleExpanded(resource, event.currentTarget)}
                  >
                    <span aria-hidden="true">{isExpanded ? '↥' : '↧'}</span>
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }} data-resource-scroll>
                  <PlanningBoardItemTable
                    items={resourceItems}
                    allocation={allocation}
                    selectedItemIds={selectedItemIds}
                    onToggleItem={onToggleItem}
                    onResourceClick={handleResourceClick}
                    onResourcePointerDown={handleResourcePointerDown}
                    resourceDragDisabled={resourceDragDisabled}
                    onRankChange={onRankChange}
                    specialDueMode={specialDueMode}
                    onSpecialDueClick={onSpecialDueClick}
                    nowMs={nowMs}
                    disabled={disabled}
                    rankDisabled={rankDisabled}
                    showRank
                    showSeiban
                    seibanRankByFseiban={seibanRankByFseiban}
                    showColumnHeaders={false}
                    tableLabel={`資源CD ${resource}の工程アイテム`}
                  />
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </div>
  );
}
