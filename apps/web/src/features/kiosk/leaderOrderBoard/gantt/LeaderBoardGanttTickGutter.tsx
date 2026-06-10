import {
  GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX,
  GANTT_TICK_GUTTER_WIDTH_PX,
  GANTT_TICK_ORIGIN_LINE_HEIGHT_PX
} from './leaderBoardGanttConstants';

import type { GanttTickMark } from './leaderBoardGanttLayout';

type Props = {
  totalHeightPx: number;
  tickMarks: readonly GanttTickMark[];
};

/**
 * カード内スクロール領域左端の 8H 目盛（操作を妨げない装飾のみ）。
 */
export function LeaderBoardGanttTickGutter({ totalHeightPx, tickMarks }: Props) {
  if (totalHeightPx <= 0) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-0"
      style={{ width: GANTT_TICK_GUTTER_WIDTH_PX, height: totalHeightPx }}
      aria-hidden
    >
      {tickMarks.map((tick) => {
        const isBoundary = tick.kind === 'boundary';
        const lineHeightPx = isBoundary
          ? GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX
          : GANTT_TICK_ORIGIN_LINE_HEIGHT_PX;
        return (
          <div
            key={`${tick.kind}-${tick.topPx}`}
            className={isBoundary ? 'absolute left-0 bg-cyan-300/80' : 'absolute left-0 bg-cyan-400/55'}
            style={{
              top: tick.topPx,
              width: GANTT_TICK_GUTTER_WIDTH_PX,
              height: lineHeightPx
            }}
          />
        );
      })}
    </div>
  );
}
