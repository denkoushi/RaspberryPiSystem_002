import { useCallback, useEffect, useMemo, useRef } from 'react';


import {
  INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX
} from '../../part-measurement/inspection-drawing/inspectionDrawingCanvasPointer';
import { formatResourceCdWithJapaneseNames } from '../leaderOrderBoard/formatResourceCdWithJapaneseNames';

import { PlanningBoardItemTable } from './PlanningBoardItemTable';
import { resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';

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

  return (
    <div className="min-w-0">
      <div className="grid min-w-0 grid-cols-1 items-start gap-2.5 lg:grid-cols-2 xl:grid-cols-4" data-testid="planning-board-resource-view">
        {groups.map(([resource, resourceItems]) => {
        return (
          <article
            key={resource}
            className="min-w-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/85"
            data-planning-board-resource-pane
            data-resource-code={resource}
            onPointerMove={handleResourcePointerMove}
            onPointerUp={handleResourcePointerUp}
            onPointerCancel={handleResourcePointerCancel}
            onLostPointerCapture={handleResourceLostPointerCapture}
          >
            <header className="flex h-7 min-h-7 min-w-0 items-center gap-2 border-b border-slate-800 px-2 py-0.5">
              <strong className="min-w-0 flex-1 truncate font-mono text-[15px] leading-none text-white">
                {formatResourceCdWithJapaneseNames(resource, resourceNameMap)}
              </strong>
            </header>
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
          </article>
        );
        })}
      </div>
    </div>
  );
}
