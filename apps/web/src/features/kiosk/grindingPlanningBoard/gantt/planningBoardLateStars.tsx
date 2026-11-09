import clsx from 'clsx';
import { useContext, useMemo } from 'react';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';

import { dateToDay } from './planningBoardGanttLayout';

import type { GanttBar } from './planningBoardGanttLayout';

export function usePlanningBoardLateStars(bars: readonly GanttBar[], today: number) {
  const { rows } = useContext(DScheduleMinutesContext);
  return useMemo(() => {
    const itemIds = new Set<string>();
    const datesBySeiban = new Map<string, Set<string>>();
    for (const bar of bars) {
      if (!bar.item.lslhSurface || bar.item.isCompleted || bar.tone === 'completed') continue;
      for (const { date } of rows.get(bar.item.fseiban)?.surfaceSendOutDates ?? []) {
        if (dateToDay(date) >= today) continue;
        itemIds.add(bar.item.itemId);
        const dates = datesBySeiban.get(bar.item.fseiban) ?? new Set<string>();
        datesBySeiban.set(bar.item.fseiban, dates.add(date));
      }
    }
    const groups = [...datesBySeiban].map(([fseiban, dates]) => ({ fseiban, dates: [...dates].sort() }))
      .sort((a, b) => a.dates[0]!.localeCompare(b.dates[0]!) || a.fseiban.localeCompare(b.fseiban));
    return { itemIds, groups };
  }, [bars, rows, today]);
}

export type PlanningBoardLateStarGroup = { fseiban: string; dates: readonly string[] };

export const LATE_STAR_BUTTON_HEIGHT = 28;
// Static dates inherit the label column’s text-xs line height.
export const LATE_STAR_TEXT_HEIGHT = 16;
export const LATE_STAR_GAP = 4;

const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 機械名の欄に、★が付いた製番ごとの処理出し日を並べる。押すとその製番のバーだけを光らせる（1つだけ）。 */
export function PlanningBoardLateStarDates({ groups, focusedSeiban = null, onToggleSeiban }: {
  groups: readonly PlanningBoardLateStarGroup[]; focusedSeiban?: string | null; onToggleSeiban?: (fseiban: string) => void;
}) {
  return groups.length > 0 && <span data-testid="planning-gantt-late-star-dates" className="flex flex-wrap" style={{ gap: LATE_STAR_GAP }}>
    {groups.map(({ fseiban, dates }) => {
      const text = `★${dates.map(shortDate).join(' ')}`;
      return onToggleSeiban
        ? <button key={fseiban} type="button" aria-pressed={focusedSeiban === fseiban} aria-label={`${fseiban} ${text}`} onClick={() => onToggleSeiban(fseiban)}
          className={clsx('rounded bg-violet-500/25 px-1.5 font-mono text-[12px] font-bold text-violet-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300',
            focusedSeiban === fseiban && 'ring-2 ring-white')} style={{ minHeight: LATE_STAR_BUTTON_HEIGHT }}>{text}</button>
        : <span key={fseiban} style={{ lineHeight: `${LATE_STAR_TEXT_HEIGHT}px` }} className="rounded bg-violet-500/25 px-1 font-mono text-[10px] text-violet-300">{text}</span>;
    })}
  </span>;
}

export function PlanningBoardLateStar({ left, top }: { left: number; top: number }) {
  return <span data-testid="planning-gantt-late-star" className="pointer-events-none absolute z-[9] text-[16px] leading-none text-violet-300"
    style={{ left, top, textShadow: '0 1px 2px #020617, 1px 0 2px #020617' }}>★</span>;
}
