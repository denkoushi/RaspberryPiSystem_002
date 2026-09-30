/** Recharts 3: zIndex ポータル初回で棒が消えるのを避ける（デフォルト bar=300 はポータル描画） */
export const loadBalancingVisibleBarProps = {
  zIndex: 0,
  isAnimationActive: false,
  minPointSize: 2
} as const;

export const loadBalancingTooltipStyle = {
  backgroundColor: '#0f172a',
  borderColor: '#334155',
  fontSize: 13
};
