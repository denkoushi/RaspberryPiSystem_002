import type { OverviewChartRow } from './mapOverviewResourceChartRows';

/**
 * 俯瞰棒グラフ X 軸ラベル帯の高さ（XAxis.height のみ — margin.bottom と二重に取らない）。
 * 外寸 lbChart.container は固定 — プロット高 = 外寸 − top margin − 本値。
 */
export const loadBalancingOverviewChartAxisBandHeight = 108;

/** 1 資源（棒 + 資源CD + 表示名）あたりの最小幅 — 48 本超は横スクロール */
export const loadBalancingOverviewChartMinTickSlotWidth = 40;

/** カテゴリ間の隙間（px）— 棒・ラベルの中央揃え用 */
export const loadBalancingOverviewChartCategoryGapPx = 12;

/**
 * 俯瞰棒グラフ X 軸の描画契約。
 *
 * 座標系: Recharts の tick 原点は X 軸線上。+Y は画面下（マージン側）、-Y はプロット（棒）側。
 * レイアウト（上→下）: 資源CD（横書き）→ gapBelowResourceCd → 表示名（vertical-rl 縦書き）。
 * 資源CD・表示名は **いずれも +Y（マージン内）**（-Y は棒と重なるため禁止）。
 */
export const loadBalancingOverviewXAxisLayout = {
  /** 軸線と棒下端の隙間 — 小さくしてプロットを確保 */
  tickMargin: 2,
  resourceCd: {
    fill: '#e2e8f0',
    fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
    textAnchor: 'middle' as const,
    /** 軸線より下・ラベル帯最上段（横書き） */
    dy: 2,
    /** 資源CD 1 行分の高さ（fontSize ベース） */
    lineHeight: 12
  },
  /** 資源CD の真下に入れる余白（表示名はこの下から開始） */
  gapBelowResourceCd: 5,
  displayName: {
    fill: '#cbd5e1',
    fontSize: 12,
    /** vertical-rl 1 文字あたりの縦ステップ（maxLength 算出用） */
    charHeight: 11,
    fontFamily: 'var(--font-family-sans, "Noto Sans JP", system-ui, sans-serif)',
    /** foreignObject + writing-mode: vertical-rl */
    writingMode: 'vertical-rl' as const,
    clipWidth: 16,
    /** SVG 下端との安全隙間（foreignObject はみ出し防止） */
    clipPaddingBottom: 8
  }
} as const;

/** 表示名グループの Y オフセット（tick 原点からの +Y） */
export function getOverviewChartDisplayNameOffsetY(): number {
  const { resourceCd, gapBelowResourceCd } = loadBalancingOverviewXAxisLayout;
  return resourceCd.dy + resourceCd.lineHeight + gapBelowResourceCd;
}

/** 表示名 clip 矩形の高さ（+Y 方向のみ使用） */
export function getOverviewChartDisplayNameClipHeight(): number {
  const { clipPaddingBottom } = loadBalancingOverviewXAxisLayout.displayName;
  return loadBalancingOverviewChartAxisBandHeight - getOverviewChartDisplayNameOffsetY() - clipPaddingBottom;
}

/** ラベル帯内に収まる最大文字数（vertical-rl の縦ステップ = charHeight） */
export function getOverviewChartDisplayNameMaxLength(): number {
  const { charHeight } = loadBalancingOverviewXAxisLayout.displayName;
  return Math.max(4, Math.floor(getOverviewChartDisplayNameClipHeight() / charHeight));
}

/** 棒グラフ Y 軸上限 — データ最大値に合わせてプロット内の余白を減らす */
export function getOverviewChartYAxisMax(rows: Pick<OverviewChartRow, 'req' | 'cap'>[]): number {
  const peak = rows.reduce((max, row) => Math.max(max, row.req, row.cap), 0);
  if (peak <= 0) return 100;
  return Math.ceil(peak * 1.04);
}

/** プロット領域の最小幅（Y 軸・左右 margin を除く） */
export function getOverviewChartPlotMinWidth(tickCount: number): number {
  if (tickCount <= 0) return 0;
  return tickCount * loadBalancingOverviewChartMinTickSlotWidth;
}

/** 横スクロール時のチャート全体最小幅（Y 軸幅 + 左右 margin + プロット） */
export function getOverviewChartMinScrollWidth(
  tickCount: number,
  yAxisWidth = 48,
  horizontalInset = 16
): number {
  return yAxisWidth + horizontalInset + getOverviewChartPlotMinWidth(tickCount);
}

/** 表示名 foreignObject 幅 — tick スロット幅に合わせて中央揃え */
export function resolveOverviewChartDisplayNameClipWidth(tickSlotWidth?: number): number {
  const { clipWidth, fontSize } = loadBalancingOverviewXAxisLayout.displayName;
  const minWidth = fontSize + 2;
  if (tickSlotWidth == null || !Number.isFinite(tickSlotWidth) || tickSlotWidth <= 0) {
    return Math.max(minWidth, clipWidth);
  }
  return Math.max(minWidth, Math.floor(tickSlotWidth * 0.92));
}

export function parseRechartsAxisTickPosition(
  x: number | string | undefined,
  y: number | string | undefined
): { x: number; y: number } {
  return {
    x: typeof x === 'number' ? x : Number(x) || 0,
    y: typeof y === 'number' ? y : Number(y) || 0
  };
}

export function formatOverviewChartAxisDisplayName(
  displayName: string,
  maxLength: number = getOverviewChartDisplayNameMaxLength()
): string {
  if (!displayName) return '';
  if (displayName.length <= maxLength) return displayName;
  return `${displayName.slice(0, maxLength - 1)}…`;
}

export function buildOverviewChartDisplayNameByCd(
  rows: Pick<OverviewChartRow, 'cd' | 'displayName'>[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.displayName) {
      map[row.cd] = row.displayName;
    }
  }
  return map;
}
