import {
  GANTT_RULER_BAR_WIDTH_PX,
  GANTT_RULER_GUTTER_WIDTH_PX
} from './leaderBoardGanttConstants';

import type { GanttRulerSegment } from './leaderBoardGanttLayout';

type Props = {
  totalHeightPx: number;
  rulerSegments: readonly GanttRulerSegment[];
};

const RULER_BAND_CLASS_BY_INDEX: Record<number, string> = {
  0: 'bg-cyan-400/75',
  1: 'bg-cyan-200/45'
};

function resolveRulerBandClass(bandIndex: number): string {
  return RULER_BAND_CLASS_BY_INDEX[bandIndex % 2] ?? RULER_BAND_CLASS_BY_INDEX[0];
}

/**
 * カード内スクロール領域左端の 8H ルーラー（操作を妨げない装飾のみ）。
 * 8H ごとの縦バーを交互色で描画する。
 */
export function LeaderBoardGanttTickGutter({ totalHeightPx, rulerSegments }: Props) {
  if (totalHeightPx <= 0) return null;

  return (
    <div
      data-testid="leader-board-gantt-ruler-gutter"
      className="pointer-events-none absolute left-0 top-0 z-0"
      style={{ width: GANTT_RULER_GUTTER_WIDTH_PX, height: totalHeightPx }}
      aria-hidden
    >
      {rulerSegments.map((segment) => (
        <div
          key={`${segment.bandIndex}-${segment.topPx}`}
          data-testid="leader-board-gantt-ruler-band"
          data-band-index={segment.bandIndex}
          className={`absolute left-0 ${resolveRulerBandClass(segment.bandIndex)}`}
          style={{
            top: segment.topPx,
            width: GANTT_RULER_BAR_WIDTH_PX,
            height: segment.heightPx
          }}
        />
      ))}
    </div>
  );
}
