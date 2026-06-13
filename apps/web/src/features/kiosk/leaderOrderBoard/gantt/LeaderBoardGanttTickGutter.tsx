import {
  GANTT_RULER_BAR_WIDTH_PX,
  GANTT_RULER_GUTTER_WIDTH_PX
} from './leaderBoardGanttConstants';

import type { GanttRulerSegment } from './leaderBoardGanttLayout';

type Props = {
  totalHeightPx: number;
  rulerSegments: readonly GanttRulerSegment[];
};

const RULER_VISIBLE_BAND_CLASS = 'bg-cyan-400/90';
const RULER_TRANSPARENT_BAND_CLASS = 'bg-transparent';

function resolveRulerBandClass(bandIndex: number): string {
  return bandIndex % 2 === 0 ? RULER_VISIBLE_BAND_CLASS : RULER_TRANSPARENT_BAND_CLASS;
}

/**
 * カード内スクロール領域左端の 8H ルーラー（操作を妨げない装飾のみ）。
 * 8H ごとの縦バーを単色/透明の交互で描画する。
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
