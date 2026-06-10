import {
  GANTT_TICK_GUTTER_WIDTH_PX,
  GANTT_TICK_LINE_HEIGHT_PX
} from './leaderBoardGanttConstants';

type Props = {
  totalHeightPx: number;
  tickPositions: readonly number[];
};

/**
 * カード内スクロール領域左端の 8H 目盛（操作を妨げない装飾のみ）。
 * 各 tick は 1px の境界線として描画する（連続塗り帯にしない）。
 */
export function LeaderBoardGanttTickGutter({ totalHeightPx, tickPositions }: Props) {
  if (totalHeightPx <= 0) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-0"
      style={{ width: GANTT_TICK_GUTTER_WIDTH_PX, height: totalHeightPx }}
      aria-hidden
    >
      {tickPositions.map((topPx) => (
        <div
          key={topPx}
          className="absolute left-0 bg-cyan-400/55"
          style={{
            top: topPx,
            width: GANTT_TICK_GUTTER_WIDTH_PX,
            height: GANTT_TICK_LINE_HEIGHT_PX
          }}
        />
      ))}
    </div>
  );
}
