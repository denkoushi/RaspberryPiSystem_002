import clsx from 'clsx';
import { memo, useCallback, useEffect, useRef } from 'react';

import { pageZoom } from '../pageZoom';

import { dateToDay, dayLabel, shiftedDueDate } from './planningBoardGanttLayout';

import type { GanttBar, GanttRow } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { PointerEvent } from 'react';

export const GANTT_LABEL_WIDTH = 320;
// 「今日から」 only shows the machine and its daily-hours buttons, so its label column is narrower.
export const GANTT_FORWARD_LABEL_WIDTH = 168;
export const GANTT_ROW_HEIGHT = 56;
export const GANTT_HATCH = 'repeating-linear-gradient(135deg, #fb7185 0 4px, #9f1239 4px 8px)';

type InteractionProps = {
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onDueDrop: (item: GrindingPlanningBoardItem, date: string) => void;
  disabled: boolean;
  dragDisabled: boolean;
  seibanColors?: ReadonlyMap<string, string>;
};
type BarProps = InteractionProps & {
  bar: GanttBar;
  start: number;
  dayWidth: number;
  today: string;
  selected: boolean;
  sibling: boolean;
  dimmed: boolean;
};
type Drag = { pointerId: number; x: number; y: number; moved: boolean; delta: number; frame: number | null; element: HTMLButtonElement };

const PlanningBoardGanttBar = memo(function PlanningBoardGanttBar({
  bar, start, dayWidth, today, selected, sibling, dimmed, disabled, dragDisabled, onToggleItem, onDueDrop, seibanColors
}: BarProps) {
  const pending = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const tip = useRef<HTMLSpanElement>(null);
  const clear = useCallback(() => {
    const drag = pending.current;
    if (!drag) return;
    pending.current = null;
    if (drag.frame != null) cancelAnimationFrame(drag.frame);
    drag.element.style.transform = '';
    drag.element.style.zIndex = '';
    if (tip.current) tip.current.hidden = true;
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  }, []);
  useEffect(() => {
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('blur', clear); clear(); };
  }, [clear]);
  useEffect(() => { clear(); }, [bar.due, clear, dayWidth, disabled, dragDisabled, start]);

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.x) > 4 || Math.abs(event.clientY - drag.y) > 4) drag.moved = true;
    if (!drag.moved || dragDisabled || !bar.due) return;
    const date = shiftedDueDate(bar.due, Math.round((event.clientX - drag.x) / pageZoom() / dayWidth), today);
    drag.delta = dateToDay(date) - dateToDay(bar.due);
    if (drag.frame != null) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      drag.element.style.transform = `translateX(${drag.delta * dayWidth}px)`;
      drag.element.style.zIndex = '10';
      if (tip.current) {
        tip.current.hidden = false;
        tip.current.textContent = `納期 ${dayLabel(dateToDay(bar.due!) + drag.delta)}`;
      }
    });
  };
  const color = bar.tone !== 'completed' ? seibanColors?.get(bar.item.fseiban) : undefined;
  const coloredLate = Boolean(color && bar.tone === 'late');
  const width = bar.unknown ? 72 : Math.max(5, (bar.end! - bar.start!) * dayWidth);
  return (
    <button
      type="button"
      data-testid={`planning-gantt-bar-${bar.item.itemId}`}
      data-drag-disabled={dragDisabled || disabled || bar.item.isCompleted}
      aria-label={`${bar.item.fhinmei || bar.item.fhincd} 工順${bar.item.processOrder} ${bar.resource} 納期${bar.due}`}
      aria-pressed={selected}
      disabled={disabled || bar.item.isCompleted}
      title={`工順${bar.item.processOrder} ${bar.resource} 納期${bar.due}`}
      className="absolute top-1.5 min-h-11 min-w-11 touch-pan-y select-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
      style={{ left: (bar.end! - start) * dayWidth - Math.max(44, width), width: Math.max(44, width), zIndex: selected ? 4 : 2 }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false || pending.current) return;
        suppressClick.current = false;
        pending.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, delta: 0, frame: null, element: event.currentTarget };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        const drag = pending.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        move(event);
        suppressClick.current = drag.moved;
        const date = bar.due ? shiftedDueDate(bar.due, drag.delta, today) : null;
        clear();
        if (!disabled && !dragDisabled && !bar.item.isCompleted && drag.moved && date && date !== bar.due) onDueDrop(bar.item, date);
      }}
      onPointerCancel={() => { suppressClick.current = true; clear(); }}
      onLostPointerCapture={() => { if (pending.current) { suppressClick.current = true; clear(); } }}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onToggleItem(bar.item, !selected);
      }}
    >
      <span className={clsx('absolute right-0 top-3 h-6 overflow-hidden whitespace-nowrap rounded px-1 text-left font-mono text-[10px] font-bold leading-6',
        bar.tone === 'completed' ? 'bg-slate-600 text-slate-300' : color ? `${color} text-slate-950` : bar.tone === 'late' ? 'bg-rose-400 text-slate-950' : 'bg-sky-400 text-slate-950',
        bar.unknown && (seibanColors ? 'border border-dashed border-slate-200' : 'border border-dashed border-slate-200 bg-slate-800 text-slate-200'),
        selected ? 'outline outline-2 outline-offset-1 outline-emerald-300' : sibling && 'outline outline-2 outline-offset-1 outline-white',
        dimmed && 'opacity-30'
      )} style={{ width, outline: coloredLate ? '3px solid rgb(251 113 133)' : undefined, outlineOffset: coloredLate ? -1 : undefined }}>
        {coloredLate && <span aria-label="遅れ" className="mr-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-rose-400 text-[10px] leading-none text-slate-950">!</span>}
        {bar.unknown ? `${bar.item.processOrder} 所要不明` : `${bar.item.processOrder} ${bar.resource}`}
        {bar.flagged && bar.overlaps.length === 0 && <i className="absolute inset-y-0 right-0 w-1" style={{ background: GANTT_HATCH }} />}
      </span>
      <span ref={tip} hidden className="absolute right-0 top-0 z-20 whitespace-nowrap rounded bg-white px-1 text-[10px] font-bold text-slate-950" />
    </button>
  );
});

export type PlanningBoardGanttRowProps = InteractionProps & {
  row: GanttRow;
  start: number;
  dayWidth: number;
  width: number;
  today: string;
  selectedItemIds: ReadonlySet<string>;
  selectedParts: ReadonlySet<string>;
  resourceView: boolean;
};

export const PlanningBoardGanttRow = memo(function PlanningBoardGanttRow({
  row, start, dayWidth, width, today, selectedItemIds, selectedParts, resourceView, ...interaction
}: PlanningBoardGanttRowProps) {
  return (
    <div data-gantt-flagged={row.flagged || undefined} className="flex border-b border-slate-800/70"
      style={{ height: GANTT_ROW_HEIGHT, contain: 'layout style', contentVisibility: 'auto', containIntrinsicSize: `auto ${GANTT_ROW_HEIGHT}px` }}>
      <div className={clsx('sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-slate-700 bg-slate-900 px-2 text-xs', row.flagged && 'border-l-2 border-l-rose-400')}
        style={{ width: GANTT_LABEL_WIDTH }}>
        {row.flagged && <span className="text-rose-300" aria-label="工程の重なり">⚠</span>}
        <span className="min-w-0 flex-1 truncate font-semibold">{row.label}<small className="block truncate font-mono text-[10px] text-slate-400">{row.detail}</small></span>
        {row.bars.some((bar) => bar.due == null) && <span className="text-slate-400">納期なし</span>}
      </div>
      <div className="relative shrink-0 overflow-hidden" style={{ width }}>
        {row.connectors.map((link, i) => <span key={i} className="pointer-events-none absolute top-7 h-px bg-slate-500" style={{ left: (link.start - start) * dayWidth, width: (link.end - link.start) * dayWidth }} />)}
        {row.bars.filter((bar) => bar.end != null).map((bar) => (
          <PlanningBoardGanttBar key={bar.item.itemId} bar={bar} start={start} dayWidth={dayWidth} today={today}
            selected={selectedItemIds.has(bar.item.itemId)} sibling={resourceView && selectedParts.has(bar.partKey)}
            dimmed={resourceView && selectedParts.size > 0 && !selectedParts.has(bar.partKey)} {...interaction} />
        ))}
        {/* Both bars of a pair carry the same span; draw it once per row. */}
        {[...new Map(row.bars.flatMap((bar) => bar.overlaps).map((span) => [`${span.start}:${span.end}`, span] as const)).entries()].map(([key, span]) => (
          <span key={key} className="pointer-events-none absolute top-4 z-[5] h-7 rounded border border-rose-100 opacity-75"
            style={{ left: (span.start - start) * dayWidth, width: Math.max(3, (span.end - span.start) * dayWidth), background: GANTT_HATCH }} />
        ))}
      </div>
    </div>
  );
});
