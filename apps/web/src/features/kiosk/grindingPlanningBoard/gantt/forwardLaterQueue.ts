import type { GanttBar } from './planningBoardGanttLayout';

export function forwardLaterQueue(bars: readonly GanttBar[], right: number) {
  const ordered = bars.filter((bar) => !bar.item.isCompleted && (bar.segments?.[0]?.start ?? bar.start ?? -Infinity) > right)
    .sort((a, b) => (a.segments?.[0]?.start ?? a.start!) - (b.segments?.[0]?.start ?? b.start!));
  return { count: ordered.length, bars: ordered };
}
