import clsx from 'clsx';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';
import { comparePlanningBoardBarOrder } from '../sortGrindingPlanningBoardItems';

import { canReorderForwardBars } from './planningBoardForwardQueue';
import { PlanningBoardSeibanLegend } from './PlanningBoardSeibanLegend';
import { PlanningBoardSeibanShelfColumn } from './PlanningBoardSeibanShelfColumn';
import { usePersistedPlanningBoardShelf } from './usePersistedPlanningBoardShelf';
import { SHELF_COLUMN_STRIDE, usePlanningBoardShelfWindow } from './usePlanningBoardShelfWindow';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { GanttBar } from './planningBoardGanttLayout';
import type { SeibanShelfColumn } from './planningBoardSeibanShelfData';
import type { ShelfDropResolver, SeibanShelfHandle, ShelfPlacementActions } from './usePlanningBoardShelfInteraction';
import type { PointerEvent, RefObject } from 'react';

const EMPTY_SELECTED: ReadonlySet<string> = new Set();

type Props = {
  columns: readonly SeibanShelfColumn[];
  interactionRef?: RefObject<SeibanShelfHandle | null>;
  getDrop?: ShelfDropResolver;
  resources?: readonly string[];
  actions?: ShelfPlacementActions;
  disabled?: boolean;
  writePending?: boolean;
  onDragPreview?: (preview: ForwardDragPreview | null) => void;
  seibanColors: ReadonlyMap<string, string>;
  focusedSeiban: string | null;
  highlightedItemId: string | null;
  onFocusedSeibanChange: (seiban: string | null) => void;
  onFocusSeiban: (seiban: string) => void;
};

export const PlanningBoardSeibanShelf = memo(forwardRef<HTMLDivElement, Props>(function PlanningBoardSeibanShelf({
  columns, seibanColors, focusedSeiban, highlightedItemId, onFocusedSeibanChange, onFocusSeiban, interactionRef, getDrop, resources, actions, disabled = false, writePending = false, onDragPreview
}, ref) {
  const { open, changeOpen } = usePersistedPlanningBoardShelf();
  const [remaining, setRemaining] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const { gate, frozen } = usePlanningBoardOffline();
  const bars = useMemo(() => new Map(columns.flatMap(column => column.parts.flatMap(part => part.units.flat().map(tile => {
    const bar: GanttBar = { item: tile.item, resource: tile.resource ?? '未設定', partKey: part.key,
      arrivalPending: tile.arrivalPending, due: column.due, start: null, end: null, unknown: true, tone: tile.late ? 'late' : 'planned', overlaps: [], flagged: false };
    return [tile.item.itemId, bar] as const;
  })))), [columns]);
  const signature = (bar: GanttBar) => JSON.stringify([bar.item.itemRevision, bar.item.version]);
  const activeSelected = useMemo(() => new Set([...selected].filter(id => bars.has(id))), [selected, bars]);
  const previousSelection = useRef<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reuse only equal per-column selection sets from the last commit.
  const selectedBySeiban = useMemo(() => {
    const next = new Map<string, ReadonlySet<string>>();
    for (const id of activeSelected) {
      const item = bars.get(id)!.item;
      if (item.kind === 'test') continue;
      const seiban = item.fseiban;
      const ids = next.get(seiban) as Set<string> | undefined;
      if (ids) ids.add(id); else next.set(seiban, new Set([id]));
    }
    for (const [seiban, ids] of next) {
      const previous = previousSelection.current.get(seiban);
      if (previous?.size === ids.size && [...ids].every(id => previous.has(id))) next.set(seiban, previous);
    }
    return next;
  }, [activeSelected, bars]);
  useLayoutEffect(() => { previousSelection.current = selectedBySeiban; }, [selectedBySeiban]);
  const highlightedBar = highlightedItemId ? bars.get(highlightedItemId) : undefined;
  const highlightedSeiban = highlightedBar && highlightedBar.item.kind !== 'test' ? highlightedBar.item.fseiban : null;
  const visibleColumns = useMemo(() => columns.filter(column => !remaining || column.placed < column.total), [columns, remaining]);
  const { viewport: shelfViewport, window: shelfWindow, reveal: revealSeiban } = usePlanningBoardShelfWindow(visibleColumns, open, focusedSeiban, highlightedSeiban ?? null, highlightedItemId);
  type Placement = { ids: string[]; resource: string; targetId: string | null; placement: 'before' | 'after'; sawPending?: boolean; waiting?: { id: string; signature: string } };
  const pending = useRef<Placement | null>(null);
  const placementFrame = useRef<number | null>(null);
  const latestPlacement = useRef({ bars, writePending });
  useLayoutEffect(() => { latestPlacement.current = { bars, writePending }; }, [bars, writePending]);
  const cancelPlacement = useCallback(() => {
    pending.current = null;
    if (placementFrame.current !== null) cancelAnimationFrame(placementFrame.current);
    placementFrame.current = null;
  }, []);
  useEffect(() => () => cancelPlacement(), [cancelPlacement]);
  useEffect(() => gate.subscribeReadOnly(cancelPlacement), [gate, cancelPlacement]);
  // A single existing write is issued at a time. The next uses the refreshed resource order/revisions,
  // after the write controls unlock; this preserves the write queue's acknowledgement and failure paths.
  const atDestination = (bar: GanttBar, batch: Placement) => {
    if (bar.resource !== batch.resource) return false;
    const order = [...bars.values()].filter(value => value.resource === batch.resource && !value.item.isCompleted).sort((a, b) => comparePlanningBoardBarOrder(a.item, b.item));
    const index = order.findIndex(value => value.item.itemId === bar.item.itemId);
    const targetIndex = batch.targetId ? order.findIndex(value => value.item.itemId === batch.targetId) : -1;
    return batch.targetId ? targetIndex >= 0 && index === targetIndex + (batch.placement === 'after' ? 1 : -1) : index === order.length - 1;
  };
  const advance = () => {
    const batch = pending.current;
    if (!batch || !actions) return;
    if (disabled || frozen) { cancelPlacement(); return; }
    if (writePending) { batch.sawPending = true; return; }
    if (batch.waiting) {
      const updated = bars.get(batch.waiting.id);
      // Rank-only saves may keep itemRevision/version; verify the saved position after pending falls.
      if (!updated || updated.resource !== batch.resource || signature(updated) === batch.waiting.signature && !(batch.sawPending && atDestination(updated, batch))) {
        if (batch.sawPending) cancelPlacement();
        return;
      }
      const id = batch.waiting.id;
      setSelected(current => { const next = new Set(current); next.delete(id); return next; });
      batch.waiting = undefined;
      if (placementFrame.current !== null) cancelAnimationFrame(placementFrame.current);
      placementFrame.current = null;
    }
    while (batch.ids.length) {
      const id = batch.ids.shift()!;
      const bar = bars.get(id);
      const target = batch.targetId ? bars.get(batch.targetId) : null;
      if (!bar || bar.item.kind === 'test' || bar.item.isCompleted || batch.targetId && !target) { cancelPlacement(); return; }
      if (atDestination(bar, batch)) { setSelected(current => { const next = new Set(current); next.delete(id); return next; }); continue; }
      if (!gate.attempt()) { cancelPlacement(); return; }
      batch.waiting = { id, signature: signature(bar) };
      batch.sawPending = false;
      if (bar.resource !== batch.resource) {
        if (!actions.canMove(bar.item, batch.resource) || target?.item.kind === 'test') { cancelPlacement(); return; }
        actions.move(bar.item, batch.resource, target?.item ?? null, batch.placement);
      } else if (target && canReorderForwardBars(bar, target)) actions.reorder(bar.item, target.item, batch.placement);
      else cancelPlacement();
      if (pending.current === batch) {
        const waiting = batch.waiting;
        // A guarded action can return without scheduling a write or causing another render.
        placementFrame.current = requestAnimationFrame(() => {
          placementFrame.current = null;
          const latest = latestPlacement.current;
          const updated = waiting && latest.bars.get(waiting.id);
          if (pending.current === batch && batch.waiting === waiting && !batch.sawPending && !latest.writePending &&
            (!updated || signature(updated) === waiting?.signature)) cancelPlacement();
        });
      }
      return;
    }
    cancelPlacement();
  };
  useEffect(() => { advance(); });
  const place = (ids: readonly string[], drop: ReturnType<ShelfDropResolver>) => {
    if (!drop || disabled || frozen || writePending || pending.current || !actions) return false;
    const moving = new Set(ids);
    const ordered = [...bars.keys()].filter(id => moving.has(id));
    if (!ordered.length) return false;
    // Inserting repeatedly after one anchor requires reverse dispatch to retain shelf order.
    if (drop.bar && drop.placement === 'after') ordered.reverse();
    pending.current = { ids: ordered, resource: drop.resource, targetId: drop.bar?.item.itemId ?? null, placement: drop.placement };
    advance();
    return true;
  };
  const allowedFor = (ids: readonly string[]) => new Set(resources?.filter(resource => ids.every(id => {
    const bar = bars.get(id);
    return bar && !bar.arrivalPending && !bar.item.isCompleted && bar.item.kind !== 'test' && (bar.resource === resource || actions?.canMove(bar.item, resource));
  })));
  useImperativeHandle(interactionRef, () => ({ placeAt: (x, y) => {
    if (!open || !activeSelected.size || !getDrop || disabled || writePending || pending.current) return false;
    const ids = [...activeSelected];
    const source = bars.get(ids[0]!);
    return source ? place(ids, getDrop(x, y, source, allowedFor(ids), new Set(ids))) : false;
  } }));
  const drag = useRef<{ pointerId: number; x: number; y: number; ids: string[]; source: GanttBar; allowed: ReadonlySet<string>; moving: ReadonlySet<string>; active: boolean; element: HTMLButtonElement } | null>(null);
  const suppressClick = useRef(false);
  const clearDrag = useCallback(() => {
    const previous = drag.current;
    drag.current = null;
    if (previous?.active) onDragPreview?.(null);
    if (previous?.element.hasPointerCapture?.(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId);
  }, [onDragPreview]);
  useEffect(() => {
    const cancel = () => { if (drag.current) suppressClick.current = true; clearDrag(); };
    window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('blur', cancel); };
  }, [clearDrag]);
  useEffect(() => { clearDrag(); }, [disabled, frozen, writePending, open, clearDrag]);
  useEffect(() => {
    if (drag.current?.ids.some(id => !bars.has(id))) { suppressClick.current = true; clearDrag(); }
  }, [bars, clearDrag]);
  useEffect(() => gate.subscribeReadOnly(clearDrag), [gate, clearDrag]);
  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    suppressClick.current = false;
    if (event.button !== 0 || disabled || frozen || writePending || pending.current || !getDrop || !onDragPreview) return;
    const source = bars.get(id);
    if (!source || source.item.isCompleted) return;
    const ids = activeSelected.has(id) ? [...bars.keys()].filter(id => activeSelected.has(id)) : [id];
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, source, ids,
      allowed: allowedFor(ids), moving: new Set(ids), active: false, element: event.currentTarget };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || !getDrop || !onDragPreview) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8) return;
    if (!current.active && !gate.attempt()) { suppressClick.current = true; clearDrag(); return; }
    current.active = true;
    suppressClick.current = true;
    event.preventDefault();
    onDragPreview({ source: 'shelf', bar: current.source, x: event.clientX, y: event.clientY, allowed: current.allowed,
      drop: getDrop(event.clientX, event.clientY, current.source, current.allowed, current.moving) });
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const drop = current.active ? getDrop?.(event.clientX, event.clientY, current.source, current.allowed, current.moving) : null;
    clearDrag();
    if (current.active) place(current.ids, drop ?? null);
  };
  const toggle = (ids: readonly string[]) => setSelected(current => {
    const next = new Set(current);
    const remove = ids.length > 0 && ids.every(id => next.has(id));
    ids.forEach(id => remove ? next.delete(id) : next.add(id));
    return next;
  });
  // Column event props keep their identity while reading the current placement/drag state.
  const handlers = { startDrag, moveDrag, endDrag, clearDrag, toggle,
    cancelDrag: () => { suppressClick.current = true; clearDrag(); },
    clickTile: (id: string) => { if (suppressClick.current) { suppressClick.current = false; return; } toggle([id]); },
    onFocus: (seiban: string, focused: boolean) => {
      revealSeiban(seiban);
      if (focused) onFocusedSeibanChange(null); else onFocusSeiban(seiban);
    } };
  const latestHandlers = useRef(handlers);
  useLayoutEffect(() => { latestHandlers.current = handlers; });
  const columnActions = useMemo(() => ({
    startDrag: (...args: Parameters<typeof startDrag>) => latestHandlers.current.startDrag(...args),
    moveDrag: (...args: Parameters<typeof moveDrag>) => latestHandlers.current.moveDrag(...args),
    endDrag: (...args: Parameters<typeof endDrag>) => latestHandlers.current.endDrag(...args),
    clearDrag: () => latestHandlers.current.clearDrag(),
    cancelDrag: () => latestHandlers.current.cancelDrag(),
    toggle: (ids: readonly string[]) => latestHandlers.current.toggle(ids),
    clickTile: (id: string) => latestHandlers.current.clickTile(id),
    onFocus: (seiban: string, focused: boolean) => latestHandlers.current.onFocus(seiban, focused)
  }), []);
  return <div ref={ref} data-testid="planning-seiban-shelf" className="shrink-0 border-t-2 border-slate-600 bg-slate-900">
    {!open ? <div className="flex items-start">
      <div className="min-w-0 flex-1"><PlanningBoardSeibanLegend seibanColors={seibanColors} focusedSeiban={focusedSeiban}
        onFocusedSeibanChange={onFocusedSeibanChange} onFocusSeiban={onFocusSeiban} /></div>
      <button type="button" aria-label="製番の棚を開く" onClick={() => changeOpen(true)} className="m-1 h-11 w-9 rounded border border-slate-600 text-slate-200">⌃</button>
    </div> : <>
      <div className="flex h-10 items-center gap-2.5 border-b border-slate-700 px-2.5">
        <div className="flex h-[30px] overflow-hidden rounded-lg border border-slate-600">
          {[false, true].map(rest => <button key={String(rest)} type="button" aria-pressed={remaining === rest} onClick={() => setRemaining(rest)}
            className={clsx('px-3 text-sm font-bold', remaining === rest ? 'bg-slate-200 text-slate-950' : 'text-slate-400')}>{rest ? '残り' : 'すべて'}</button>)}
        </div>
        {activeSelected.size > 0 && <span className="inline-flex h-[30px] items-center gap-2 rounded-full bg-white pl-3 pr-1 text-[15px] font-extrabold text-slate-950">{activeSelected.size}件
          <button type="button" aria-label="選択を外す" onClick={() => { cancelPlacement(); setSelected(new Set()); }} className="h-6 w-6 rounded-full bg-slate-950 text-white">✕</button>
        </span>}
        <button type="button" aria-label="製番の棚を畳む" onClick={() => changeOpen(false)} className="ml-auto h-[30px] w-9 rounded border border-slate-600 text-slate-200">⌄</button>
      </div>
      <div ref={shelfViewport} role="group" aria-label="製番の棚" data-shelf-focus={focusedSeiban !== null ? '' : undefined} className="[&[data-shelf-focus]_[data-shelf-unfocused]]:opacity-[.35] flex h-[min(420px,39dvh)] min-h-0 gap-2 overflow-x-auto overflow-y-hidden p-2">
        {shelfWindow.start > 0 && <div aria-hidden="true" className="shrink-0" style={{ width: shelfWindow.start * SHELF_COLUMN_STRIDE - 8 }} />}
        {visibleColumns.slice(shelfWindow.start, shelfWindow.end).map(column => <PlanningBoardSeibanShelfColumn key={column.seiban}
          column={column} remaining={remaining} focused={focusedSeiban === column.seiban}
          highlightedItemId={highlightedSeiban === column.seiban ? highlightedItemId : null}
          selected={selectedBySeiban.get(column.seiban) ?? EMPTY_SELECTED} {...columnActions} />)}
        {shelfWindow.end < visibleColumns.length && <div aria-hidden="true" className="shrink-0" style={{ width: (visibleColumns.length - shelfWindow.end) * SHELF_COLUMN_STRIDE - 8 }} />}
      </div>
    </>}
  </div>;
}));
