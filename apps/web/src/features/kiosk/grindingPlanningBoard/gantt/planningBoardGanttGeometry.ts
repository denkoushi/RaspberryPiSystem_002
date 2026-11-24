import type { GanttBar } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardBar } from '@raspi-system/shared-types';

export function unknownPlanningBarWidth(item: GrindingPlanningBoardBar): number {
  return item.kind !== 'test' && item.standardHoursMissing ? 128 : 72;
}

/** 日付と時刻を1行にした、並び表示の見出しの高さ。 */
export const GANTT_HEADER_HEIGHT = 24;
/** 並び表示の行: 片の上に、同じ部品の線が行の境目に重ならずに通る余白を取る。 */
export const NORMAL_BAR_TOP = 11;
/** 片の下は資源CDチップまで3px。 */
export const NORMAL_ROW_BASE_HEIGHT = NORMAL_BAR_TOP + 73;

/** 1台表示の行: 時刻の文字の下に、同じ部品の線が片の上を通る余白を取る。 */
export const FOLDED_BAR_TOP = 34;
/** 片の下に、線が下を通る余白を取ってから資源CDチップを置く。 */
export const FOLDED_ROW_BASE_HEIGHT = FOLDED_BAR_TOP + 70 + 20;

export function operationSplitGap(bar: GanttBar, lastSegment = true) {
  return bar.item.kind === 'piece' && bar.item.opRange ? bar.opSplitLast !== false && lastSegment ? 8 : 0 : 2;
}

/** The same CSS pixel geometry as the bar buttons, independent of whether they are mounted. */
export function ganttBarGeometry(bar: GanttBar, start: number, dayWidth: number, forward: boolean, last = false, folded = false, verticalScale = 1) {
  if (forward) {
    const segment = bar.unknown && !folded ? { start: bar.start!, end: bar.end! }
      : last ? bar.segments?.at(-1) : bar.segments?.[0];
    if (!segment) return null;
    return { left: (segment.start - start) * dayWidth, width: bar.unknown && !folded ? 70 : Math.max(2, (segment.end - segment.start) * dayWidth - operationSplitGap(bar, last || (bar.segments?.length ?? 0) === 1)), top: (folded ? FOLDED_BAR_TOP : NORMAL_BAR_TOP) * verticalScale, height: 70 * verticalScale };
  }
  if (bar.end == null) return null;
  const width = Math.max(44, bar.unknown ? unknownPlanningBarWidth(bar.item) : Math.max(5, (bar.end - bar.start!) * dayWidth));
  return { left: (bar.end - start) * dayWidth - width, width, top: 6, height: 44 };
}
