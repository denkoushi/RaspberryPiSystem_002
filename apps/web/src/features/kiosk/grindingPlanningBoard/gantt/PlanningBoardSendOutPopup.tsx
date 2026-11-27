import clsx from 'clsx';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { normalizeMachineName } from '../../productionSchedule/machineName';
import {
  progressOverviewProcessChipClassName, progressOverviewResourceAriaLabel, progressOverviewResourceTooltip
} from '../../productionSchedule/progressOverviewPresentation';
import { usePlanningBoardOffline } from '../offline/planningBoardOfflineContext';
import { pageZoom } from '../pageZoom';

import { allowedForwardDropResources, beginForwardDropCache, findForwardDrop, forwardDropBoard, invalidateForwardDropCache, placeForwardBar } from './planningBoardForwardDrop';
import { dateToDay, dayLabel } from './planningBoardGanttLayout';

import type { PlanningBoardProcessChipsByPart } from '../planningBoardProcessChips';
import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { PlanningBoardGanttResourceMove } from './planningBoardGanttViewTypes';
import type { SendOutRow } from './planningBoardLateStars';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';
import type { MouseEvent, PointerEvent, RefObject } from 'react';

export function PlanningBoardSendOutButton({ label, count, open, onToggle }: {
  label: string; count: number; open: boolean; onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return count > 0 && <button type="button" aria-label={`${label} 処理出しの部品 ${count}件`}
    aria-expanded={open} data-planning-send-out-button onClick={onToggle}
    className={clsx('h-[30px] shrink-0 rounded-md bg-violet-500/25 px-2 font-mono text-[15px] font-bold leading-none text-violet-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300',
      open && 'ring-2 ring-white')}>★{count}</button>;
}

type DragOptions = PlanningBoardGanttResourceMove & {
  lanes: { readonly current: readonly ForwardDragLane[] };
  viewport: RefObject<HTMLDivElement | null>;
  start: number;
  dayWidth: number;
  rowKeyOf: (id: string) => string | undefined;
  onStart: () => void;
};
type Pending = {
  id: string; pointerId: number; x: number; y: number; allowed?: ReadonlySet<string>;
};

const columns = ['', '処理日', '予定', '製番', '機種名', '製造オーダ番号', '品番', '品名', '処理先', '数量', '着', '工順', '納期'];

export type SendOutPopupPosition = { left: number; top: number };

export function PlanningBoardSendOutPopup({ label, resource, rows, today, chipsByPart, lastPosition, drag, draggedItemId, onPreview, onFocus, onClose }: {
  label: string;
  resource: string;
  rows: readonly SendOutRow[];
  today: number;
  chipsByPart: PlanningBoardProcessChipsByPart;
  lastPosition: { current: SendOutPopupPosition | undefined };
  drag?: DragOptions;
  draggedItemId?: string;
  onPreview: (preview: ForwardDragPreview | null) => void;
  onFocus: (bar: SendOutRow['bar']) => void;
  onClose: () => void;
}) {
  const { gate } = usePlanningBoardOffline();
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(() => lastPosition.current);
  const moveWindow = (next: SendOutPopupPosition) => {
    lastPosition.current = next;
    setPosition(next);
  };
  // A wider list can open at a position remembered for a narrower one; pull it back on screen once per row change.
  useLayoutEffect(() => {
    const at = lastPosition.current;
    const box = panel.current?.getBoundingClientRect();
    if (!at || !box || box.right - globalThis.innerWidth < 1) return;
    const next = { left: Math.max(0, globalThis.innerWidth - box.width) / pageZoom(), top: at.top };
    if (Math.abs(next.left - at.left) < 1) return;
    lastPosition.current = next;
    setPosition(next);
  }, [rows, lastPosition]);
  const headerDrag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const pending = useRef<Pending | null>(null);
  const suppressClick = useRef(false);
  const cancel = useCallback(() => {
    const current = pending.current;
    pending.current = null;
    if (current?.allowed) onPreview(null);
  }, [onPreview]);
  useEffect(() => gate.subscribeReadOnly(cancel), [gate, cancel]);
  useEffect(() => { if (!drag) cancel(); }, [drag, cancel]);
  useEffect(() => {
    if (pending.current && !rows.some(({ bar }) => bar.item.itemId === pending.current!.id)) cancel();
  }, [rows, cancel]);
  useEffect(() => {
    globalThis.addEventListener('blur', cancel);
    return () => { globalThis.removeEventListener('blur', cancel); cancel(); };
  }, [cancel]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const dragging = Boolean(pending.current?.allowed);
      const active = document.activeElement;
      if (!dragging && !(active === null || active === document.body || panel.current?.contains(active) || active.closest('[data-planning-send-out-button]'))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (dragging) cancel();
      else onClose();
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [cancel, onClose]);
  const dropAt = (event: PointerEvent, bar: SendOutRow['bar'], allowed: ReadonlySet<string>) => drag
    ? findForwardDrop(event.clientX, event.clientY, bar, allowed, forwardDropBoard(drag.viewport.current),
      drag.lanes.current, drag.start, drag.dayWidth) : null;

  return createPortal(<section ref={panel} role="region" aria-labelledby={titleId} data-planning-send-out
    className="fixed z-[100] flex max-h-[min(460px,calc(100%-32px))] w-max max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-[10px] border border-slate-600 bg-[#111a2c] text-slate-200 shadow-[0_20px_60px_rgba(0,0,0,.6)]"
    style={position ?? { left: '50%', bottom: 16, transform: 'translateX(-50%)' }}>
    <header className="flex touch-none select-none items-center gap-3 border-b border-[#24324a] py-2 pl-4 pr-2 [cursor:move]"
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false || (event.target as Element).closest('button')) return;
        const box = panel.current!.getBoundingClientRect();
        const zoom = pageZoom();
        headerDrag.current = { x: event.clientX - box.left, y: event.clientY - box.top, pointerId: event.pointerId };
        moveWindow({ left: box.left / zoom, top: box.top / zoom });
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const held = headerDrag.current;
        if (!held || held.pointerId !== event.pointerId) return;
        const zoom = pageZoom();
        const width = panel.current!.getBoundingClientRect().width;
        const headerHeight = event.currentTarget.getBoundingClientRect().height;
        moveWindow({
          left: Math.max(0, Math.min(globalThis.innerWidth - width, event.clientX - held.x)) / zoom,
          top: Math.max(0, Math.min(globalThis.innerHeight - headerHeight, event.clientY - held.y)) / zoom
        });
      }}
      onPointerUp={() => { headerDrag.current = null; }}
      onPointerCancel={() => { headerDrag.current = null; }}
      onLostPointerCapture={() => { headerDrag.current = null; }}>
      <h2 id={titleId} className="text-[17px] font-bold">{label} <span className="ml-1.5 font-mono text-violet-300">★{rows.length}</span></h2>
      <button type="button" aria-label="閉じる" onClick={onClose}
        className="ml-auto h-11 w-11 shrink-0 rounded-lg border border-[#24324a] text-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">×</button>
    </header>
    <div className="min-w-0 overflow-auto">
      <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-left text-[15px] [&_td]:border-b [&_td]:border-[#24324a] [&_td]:px-1.5 [&_td]:py-[7px]">
        <thead><tr>{columns.map((column) => <th key={column} scope="col" className="sticky top-0 z-[1] border-b border-[#24324a] bg-[#16213a] px-1.5 py-[7px] text-[13px] text-slate-400">{column}</th>)}</tr></thead>
        <tbody>{rows.map(({ bar, sendOutDay }) => {
          const { item } = bar;
          const over = today - sendOutDay;
          const rowKey = drag?.rowKeyOf(item.itemId);
          const draggable = Boolean(rowKey && !item.standardHoursMissing);
          return <tr key={item.itemId} tabIndex={0}
            className={clsx('select-none hover:bg-slate-400/[.08] focus-visible:bg-slate-700 focus-visible:outline-none',
              draggable ? 'cursor-grab' : 'cursor-pointer', draggedItemId === item.itemId && 'opacity-[.35]')}
            onClick={(event) => { if (!suppressClick.current || event.detail === 0) onFocus(bar); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onFocus(bar); } }}
            onPointerDown={(event) => {
              if (event.button !== 0 || event.isPrimary === false || pending.current) return;
              suppressClick.current = false;
              if (!draggable) return;
              pending.current = { id: item.itemId, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = pending.current;
              if (!drag || !current || current.id !== item.itemId || current.pointerId !== event.pointerId) return;
              if (!current.allowed) {
                if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
                suppressClick.current = true;
                if (!gate.canWrite()) { gate.attempt(); cancel(); return; }
                drag.onStart();
                current.allowed = allowedForwardDropResources(bar, drag.lanes.current, drag.canMoveResource);
                beginForwardDropCache();
              }
              onPreview({ bar, rowKey, x: event.clientX, y: event.clientY, allowed: current.allowed,
                drop: dropAt(event, bar, current.allowed) });
            }}
            onPointerUp={(event) => {
              const current = pending.current;
              if (!current || current.pointerId !== event.pointerId) return;
              if (current.allowed) invalidateForwardDropCache();
              const drop = current.allowed && current.id === item.itemId ? dropAt(event, bar, current.allowed) : null;
              cancel();
              if (drop && drag && gate.attempt()) placeForwardBar(bar, drop, drag.onResourceReorder, drag.onResourceMove);
            }}
            onPointerCancel={cancel} onLostPointerCapture={cancel}>
            <td aria-hidden="true" className={clsx('text-base tracking-[-3px] text-slate-400', draggable && 'touch-none')}>{draggable && '⋮⋮'}</td>
            <td className="font-mono font-bold text-violet-300">★{dayLabel(sendOutDay)}
              {over > 0 && <span className="ml-1.5 text-[13px] text-violet-300/75">{over}日過ぎ</span>}
            </td>
            <td className={clsx('font-mono font-bold', bar.end != null && Math.floor(bar.end) > sendOutDay && 'text-amber-400')}>
              {bar.start == null ? '' : dayLabel(Math.floor(bar.start))}
            </td>
            <td className="font-mono">{item.fseiban}</td>
            <td>{normalizeMachineName(item.machineName)}</td>
            <td className="font-mono">{item.productNo}</td>
            <td className="font-mono">{item.fhincd}</td>
            <td>{item.fhinmei}</td>
            <td>{item.sendOutDestinationName}</td>
            <td className="font-mono">{item.kind === 'piece' ? item.quantity : item.plannedQuantity}</td>
            <td className="font-bold text-emerald-300">{item.arrived && '着'}</td>
            <td><div className="flex gap-[3px]">
              {chipsByPart.get(bar.partKey)?.map((chip) => <span key={chip.rowId}
                title={progressOverviewResourceTooltip(chip.resourceNames)}
                aria-label={progressOverviewResourceAriaLabel(chip.resourceCd, chip.resourceNames)}
                className={clsx(progressOverviewProcessChipClassName(chip.isCompleted), 'shrink-0 font-mono !text-xs !leading-none',
                  chip.resourceCd === resource && 'ring-2 ring-white')}>{chip.resourceCd}</span>)}
            </div></td>
            <td className="font-mono text-[14px] text-slate-400">{bar.due ? dayLabel(dateToDay(bar.due)) : ''}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>, document.body);
}
