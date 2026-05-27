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

export const loadBalancingChartMargin = { top: 8, right: 16, left: 0, bottom: 48 };

export const loadBalancingTooltipStyle = {
  backgroundColor: '#0f172a',
  borderColor: '#334155',
  fontSize: 11
};

export const loadBalancingAxisTick = { fill: '#e2e8f0', fontSize: 10 };

export const loadBalancingLegendStyle = { fontSize: 11, color: '#e2e8f0' };

export const loadBalancingGridStroke = '#334155';
