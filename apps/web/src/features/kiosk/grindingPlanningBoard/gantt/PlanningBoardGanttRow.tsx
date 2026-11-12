import clsx from 'clsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { KioskResourceProcessChips } from '../../../../components/kiosk/resourceProgress/KioskResourceProcessChips';
import { usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';
import { pageZoom } from '../pageZoom';
import { PlanningBoardCompletionButton } from '../PlanningBoardCompletionButton';
import { PlanningBoardPiecePopover } from '../PlanningBoardPiecePopover';
import { usePlanningBoardProcessChips } from '../planningBoardProcessChips';

import { ganttBarGeometry } from './planningBoardGanttGeometry';
import { isNormalGanttBar , dateToDay, dayLabel, shiftedDueDate } from './planningBoardGanttLayout';
import { PlanningBoardGanttSendOutStars } from './PlanningBoardGanttSendOutStars';
import {
  estimateLateStarLabelHeight,
  PlanningBoardLateStar, PlanningBoardLateStarDates, type PlanningBoardToggleSeiban, usePlanningBoardLateStars
} from './planningBoardLateStars';
import { PIECE_NOTCH_MIN_WIDTH, pieceNotchClipPath } from './planningBoardPieceNotch';
import { operationSplitColor } from './planningBoardSeibanColor';
import { PlanningBoardUnitBarSections } from './PlanningBoardUnitBarSections';

import type { NormalGanttBar as GanttBar, GanttRow } from './planningBoardGanttLayout';
import type { GanttWindow } from './usePlanningBoardGanttWindow';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { PointerEvent } from 'react';

export const GANTT_LABEL_WIDTH = 320;
// 「今日から」 only shows the machine and its daily-hours buttons, so its label column is narrower.
export const GANTT_FORWARD_LABEL_WIDTH = 168;
export const GANTT_ROW_HEIGHT = 56;
export const GANTT_IMPORT_HATCH = 'repeating-linear-gradient(135deg, #475569 0 6px, #334155 6px 12px)';
export const GANTT_HATCH = 'repeating-linear-gradient(135deg, #fb7185 0 4px, #9f1239 4px 8px)';

type InteractionProps = {
  pieceDisabled?: boolean;
  showPieceQuantity?: boolean;
  onCompleteToggle?: (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete') => void;
  completionPendingItemIds?: ReadonlySet<string>;
  completionTargetId?: string | null;
  onCompletionTarget?: (itemId: string) => void;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onDueDrop: (item: GrindingPlanningBoardItem, date: string) => void;
  disabled: boolean;
  dragDisabled: boolean;
  seibanColors?: ReadonlyMap<string, string>;
  focusedSeiban?: string | null;
};
type BarProps = InteractionProps & {
  bar: GanttBar;
  onHeldItem: (itemId: string | null) => void;
  start: number;
  dayWidth: number;
  today: string;
  selected: boolean;
  sibling: boolean;
  dimmed: boolean;
};
type Drag = { pointerId: number; x: number; y: number; moved: boolean; delta: number; frame: number | null; element: HTMLButtonElement };

const PlanningBoardGanttBar = memo(function PlanningBoardGanttBar({
  bar, onHeldItem, start, dayWidth, today, selected, sibling, dimmed, disabled, pieceDisabled, showPieceQuantity, dragDisabled, onToggleItem, onDueDrop, onCompleteToggle, completionPendingItemIds, completionTargetId, onCompletionTarget, seibanColors, focusedSeiban = null
}: BarProps) {
  const { gate, frozen } = usePlanningBoardOffline();
  const pending = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const tip = useRef<HTMLSpanElement>(null);
  const clear = useCallback(() => {
    const drag = pending.current;
    if (!drag) return;
    pending.current = null;
    onHeldItem(null);
    if (drag.frame != null) cancelAnimationFrame(drag.frame);
    drag.element.style.transform = '';
    drag.element.style.zIndex = '';
    if (tip.current) tip.current.hidden = true;
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  }, [onHeldItem]);
  useEffect(() => gate.subscribeReadOnly(clear), [clear, gate]);
  useEffect(() => {
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('blur', clear); clear(); };
  }, [clear]);
  useEffect(() => { clear(); }, [bar.due, clear, dayWidth, disabled, dragDisabled, frozen, start]);

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.x) > 4 || Math.abs(event.clientY - drag.y) > 4) drag.moved = true;
    if (drag.moved && !gate.canWrite()) { gate.attempt(); clear(); return; }
    if (!drag.moved || dragDisabled || bar.item.isCompleted || !bar.due) return;
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
  const split = Boolean(bar.item.opRange);
  const opIndex = bar.opSplitIndex ?? 0;
  const width = bar.unknown ? 72 : Math.max(5, (bar.end! - bar.start!) * dayWidth);
  return (
    <>
    <button
      type="button"
      data-testid={`planning-gantt-bar-${bar.item.itemId}`}
      data-drag-disabled={dragDisabled || disabled || bar.item.isCompleted}
      aria-label={`${bar.item.fhinmei || bar.item.fhincd} 工順${bar.item.processOrder} ${bar.resource} 納期${bar.due}`}
      aria-pressed={selected}
      disabled={disabled}
      title={`工順${bar.item.processOrder} ${bar.resource} 納期${bar.due}`}
      className={clsx("absolute top-1.5 min-h-11 min-w-11 touch-pan-y select-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300", bar.item.quantityWarning && "outline outline-2 -outline-offset-2 outline-red-500")}
      style={{ left: (bar.end! - start) * dayWidth - Math.max(44, width), width: Math.max(44, width), zIndex: selected ? 4 : 2 }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false || pending.current || bar.item.isCompleted) return;
        onHeldItem(bar.item.itemId);
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
        if (!disabled && !dragDisabled && !bar.item.isCompleted && drag.moved && date && date !== bar.due && gate.attempt()) onDueDrop(bar.item, date);
      }}
      onPointerCancel={() => { suppressClick.current = true; clear(); }}
      onLostPointerCapture={() => { if (pending.current) { suppressClick.current = true; clear(); } }}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onCompletionTarget?.(bar.item.itemId);
        if (!bar.item.isCompleted) onToggleItem(bar.item, !selected);
      }}
    >
      <span className={clsx('absolute right-0 top-3 h-6 overflow-hidden whitespace-nowrap rounded px-1 text-left font-mono text-[10px] font-bold leading-6',
        bar.tone === 'completed' ? 'bg-slate-600 text-slate-300' : color ? `${color} text-slate-950` : bar.tone === 'late' ? 'bg-rose-400 text-slate-950' : 'bg-sky-400 text-slate-950',
        bar.unknown && (seibanColors ? 'border border-dashed border-slate-200' : 'border border-dashed border-slate-200 bg-slate-800 text-slate-200'),
        selected ? 'outline outline-2 outline-offset-1 outline-emerald-300' : sibling && 'outline outline-2 outline-offset-1 outline-white',
        focusedSeiban !== null ? focusedSeiban === bar.item.fseiban ? 'ring-2 ring-white' : 'opacity-20 saturate-[.3]' : dimmed ? 'opacity-30' : undefined
      )} style={{ width, background: bar.tone === 'completed' && bar.item.completionSource === 'import' ? GANTT_IMPORT_HATCH : split && !bar.unknown && bar.tone !== 'completed' ? operationSplitColor(color ?? (bar.tone === 'late' ? 'bg-rose-400' : undefined), opIndex) : undefined, borderRadius: split && !bar.item.itemId.startsWith('piece:') ? 0 : undefined, borderLeft: split && opIndex > 0 ? '1px solid rgb(2 6 23 / .6)' : undefined, clipPath: !split && bar.item.kind === 'piece' && width >= PIECE_NOTCH_MIN_WIDTH ? pieceNotchClipPath({ left: true, right: true }) : undefined }}>
        {bar.opSegments && <PlanningBoardUnitBarSections bar={bar} start={bar.start!} end={bar.end!} />}
        {split ? opIndex === 0 && width >= 48 ? <span className="relative">{bar.item.fhinmei || bar.item.fhincd}</span> : null : bar.opSegments ? <span className="relative">{bar.item.processOrder} {bar.resource}</span>
          : bar.unknown ? `${bar.item.processOrder} 所要不明` : `${bar.item.processOrder} ${bar.resource}`}
        {bar.flagged && bar.overlaps.length === 0 && <i className="absolute inset-y-0 right-0 w-1" style={{ background: GANTT_HATCH }} />}
      </span>
      {split && <span aria-hidden="true" data-gantt-unit-underline className="pointer-events-none absolute right-0 top-[39px] h-[3px] rounded" style={{ width, background: operationSplitColor(color, 0) }} />}
      <span ref={tip} hidden className="absolute right-0 top-0 z-20 whitespace-nowrap rounded bg-white px-1 text-[10px] font-bold text-slate-950" />
    </button>
    {onCompleteToggle && completionTargetId === bar.item.itemId && <div
      className="absolute top-0 z-10 flex w-max items-start"
      style={{ left: Math.max(0, (bar.end! - start) * dayWidth), transform: `translateX(max(-100%, ${-Math.max(0, (bar.end! - start) * dayWidth)}px))` }}>
      {showPieceQuantity && <PlanningBoardPiecePopover item={bar.item} variant="gantt" selected={selected} disabled={pieceDisabled || disabled || completionPendingItemIds?.has(bar.item.itemId)} />}
      <PlanningBoardCompletionButton item={bar.item} onToggle={onCompleteToggle}
        disabled={disabled || completionPendingItemIds?.has(bar.item.itemId)} />
    </div>}
    </>
  );
});

export type PlanningBoardGanttRowProps = InteractionProps & {
  row: GanttRow;
  window?: GanttWindow;
  registerRow?: (key: string, element: HTMLDivElement | null) => void;
  start: number;
  dayWidth: number;
  width: number;
  today: string;
  selectedItemIds: ReadonlySet<string>;
  selectedParts: ReadonlySet<string>;
  resourceView: boolean;
  onToggleSeiban?: PlanningBoardToggleSeiban;
};

export const PlanningBoardGanttRow = memo(function PlanningBoardGanttRow({
  row, window = null, registerRow, start, dayWidth, width, today, selectedItemIds, selectedParts, resourceView, onToggleSeiban, ...interaction
}: PlanningBoardGanttRowProps) {
  const rowRef = useCallback((element: HTMLDivElement | null) => registerRow?.(row.key, element), [registerRow, row.key]);
  const [heldItemId, setHeldItemId] = useState<string | null>(null);
  const visibleBars = row.bars.filter(isNormalGanttBar).filter((bar) => {
    const rect = ganttBarGeometry(bar, start, dayWidth, false);
    return rect && (!window || heldItemId === bar.item.itemId || rect.left <= window.right && rect.left + rect.width >= window.left);
  });
  const visibleIds = new Set(visibleBars.map((bar) => bar.item.itemId));
  const chipsByPart = usePlanningBoardProcessChips();
  const lateStars = usePlanningBoardLateStars(row.bars, dateToDay(today));
  // px-2 on both sides; reserve space for the optional warning and missing-due labels.
  const labelWidth = GANTT_LABEL_WIDTH - 16 - (row.flagged ? 16 : 0) - (row.bars.some((bar) => bar.due == null) ? 52 : 0);
  const estimatedHeight = Math.max(GANTT_ROW_HEIGHT, estimateLateStarLabelHeight(lateStars.groups, labelWidth, Boolean(onToggleSeiban)));
  // One chip strip per part, under that part's last bar on this row.
  const lastBarByPart = new Map<string, GanttBar>();
  for (const bar of row.bars.filter(isNormalGanttBar)) {
    if (bar.end == null) continue;
    const last = lastBarByPart.get(bar.partKey);
    if (!last || bar.end > last.end!) lastBarByPart.set(bar.partKey, bar);
  }
  return (
    <div ref={rowRef} data-gantt-flagged={row.flagged || undefined} className="flex border-b border-slate-800/70"
      style={{ minHeight: GANTT_ROW_HEIGHT, contain: 'layout style', contentVisibility: 'auto', containIntrinsicSize: `auto ${estimatedHeight}px` }}>
      <div className={clsx('sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-slate-700 bg-slate-900 px-2 text-xs', row.flagged && 'border-l-2 border-l-rose-400')}
        style={{ width: GANTT_LABEL_WIDTH }}>
        {row.flagged && <span className="text-rose-300" aria-label="工程の重なり">⚠</span>}
        <div className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{row.label}<small className="block truncate font-mono text-[10px] text-slate-400">{row.detail}</small></span>
          <PlanningBoardLateStarDates groups={lateStars.groups} focusedSeiban={interaction.focusedSeiban} onToggleSeiban={onToggleSeiban} />
        </div>
        {row.bars.some((bar) => bar.due == null) && <span className="text-slate-400">納期なし</span>}
      </div>
      <div className="relative shrink-0 overflow-hidden" style={{ width }}>
        <PlanningBoardGanttSendOutStars bars={row.bars} window={window} start={start} dayWidth={dayWidth} />
        {row.connectors.map((link, i) => <span key={i} className="pointer-events-none absolute top-7 h-px bg-slate-500" style={{ left: (link.start - start) * dayWidth, width: (link.end - link.start) * dayWidth }} />)}
        {visibleBars.map((bar) => (
          <PlanningBoardGanttBar key={bar.item.itemId} bar={bar} onHeldItem={setHeldItemId} start={start} dayWidth={dayWidth} today={today}
            selected={selectedItemIds.has(bar.item.itemId)} sibling={resourceView && selectedParts.has(bar.partKey)}
            dimmed={resourceView && selectedParts.size > 0 && !selectedParts.has(bar.partKey)} {...interaction} />
        ))}
        {visibleBars.filter((bar) => lateStars.itemIds.has(bar.item.itemId)).map((bar) => (
          <PlanningBoardLateStar key={`late:${bar.item.itemId}`} left={(bar.end! - start) * dayWidth - (bar.unknown ? 72 : Math.max(5, (bar.end! - bar.start!) * dayWidth))} top={26} />
        ))}
        {[...lastBarByPart.values()].filter((bar) => visibleIds.has(bar.item.itemId)).map((bar) => {
          const chips = chipsByPart.get(bar.partKey);
          return chips && chips.length > 0 ? (
            <div key={`chips:${bar.partKey}`} className="pointer-events-none absolute top-9 z-[3] w-max -translate-x-full"
              style={{ left: (bar.end! - start) * dayWidth }}>
              <KioskResourceProcessChips processes={chips} />
            </div>
          ) : null;
        })}
        {/* Both bars of a pair carry the same span; draw it once per row. */}
        {[...new Map(row.bars.flatMap((bar) => bar.overlaps).map((span) => [`${span.start}:${span.end}`, span] as const)).entries()].map(([key, span]) => (
          <span key={key} className="pointer-events-none absolute top-4 z-[5] h-7 rounded border border-rose-100 opacity-75"
            style={{ left: (span.start - start) * dayWidth, width: Math.max(3, (span.end - span.start) * dayWidth), background: GANTT_HATCH }} />
        ))}
      </div>
    </div>
  );
});
