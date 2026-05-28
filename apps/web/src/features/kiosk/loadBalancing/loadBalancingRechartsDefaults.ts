import { loadBalancingOverviewChartAxisBandHeight } from './loadBalancingOverviewChartAxis';

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

/** 凡例はチャート外（上部）。下余白は XAxis.height のみ（margin.bottom と二重確保しない） */
export const loadBalancingChartMargin = {
  top: 4,
  right: 12,
  left: 4,
  bottom: 0
};

export const loadBalancingOverviewChartXAxisHeight = loadBalancingOverviewChartAxisBandHeight;

export const loadBalancingTooltipStyle = {
  backgroundColor: '#0f172a',
  borderColor: '#334155',
  fontSize: 13
};

/** BarChart ホバー強調 — デフォルト fill:#ccc の帯は棒を隠すため枠線のみ */
export const loadBalancingTooltipCursor = {
  fill: 'none',
  stroke: '#94a3b8',
  strokeWidth: 1
} as const;

/** プレビュー .bar-label(10px)より一段大きく — 実機で軸ラベルが潰れないよう */
export const loadBalancingAxisTick = { fill: '#e2e8f0', fontSize: 13 };

export const loadBalancingGridStroke = '#334155';
