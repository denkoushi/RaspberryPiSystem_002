import type { GanttBar } from './planningBoardGanttLayout';

export function operationSplitGap(bar: GanttBar, lastSegment = true) {
  return bar.item.kind === 'piece' && bar.item.opRange ? bar.opSplitLast !== false && lastSegment ? 8 : 0 : 2;
}

/** The same CSS pixel geometry as the bar buttons, independent of whether they are mounted. */
export function ganttBarGeometry(bar: GanttBar, start: number, dayWidth: number, forward: boolean, last = false, folded = false) {
  if (forward) {
    const segment = bar.unknown && !folded ? { start: bar.start!, end: bar.end! }
      : last ? bar.segments?.at(-1) : bar.segments?.[0];
    if (!segment) return null;
    return { left: (segment.start - start) * dayWidth, width: bar.unknown && !folded ? 70 : Math.max(2, (segment.end - segment.start) * dayWidth - operationSplitGap(bar, last || (bar.segments?.length ?? 0) === 1)), top: folded ? 22 : 3, height: 70 };
  }
  if (bar.end == null) return null;
  const width = Math.max(44, bar.unknown ? 72 : Math.max(5, (bar.end - bar.start!) * dayWidth));
  return { left: (bar.end - start) * dayWidth - width, width, top: 6, height: 44 };
}
