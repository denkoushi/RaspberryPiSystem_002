/** Recharts 3: zIndex ポータル初回で棒が消えるのを避ける（デフォルト bar=300 はポータル描画） */
export const loadBalancingVisibleBarProps = {
  zIndex: 0,
  isAnimationActive: false,
  minPointSize: 2
} as const;

export const LOAD_BALANCING_REQ_FILL = '#38bdf8';
export const LOAD_BALANCING_CAP_FILL = '#34d399';
export const LOAD_BALANCING_OVER_REQ_FILL = '#f59e0b';
export const LOAD_BALANCING_OVER_REQ_STROKE = '#be123c';

/** 凡例はチャート外（上部）— プロット領域は棒・軸に専有 */
export const loadBalancingChartMargin = { top: 8, right: 12, left: 4, bottom: 52 };

export const loadBalancingTooltipStyle = {
  backgroundColor: '#0f172a',
  borderColor: '#334155',
  fontSize: 13
};

/** プレビュー .bar-label(10px)より一段大きく — 実機で軸ラベルが潰れないよう */
export const loadBalancingAxisTick = { fill: '#e2e8f0', fontSize: 13 };

export const loadBalancingGridStroke = '#334155';
