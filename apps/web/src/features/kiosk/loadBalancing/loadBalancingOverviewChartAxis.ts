import type { OverviewChartRow } from './mapOverviewResourceChartRows';

/**
 * 俯瞰棒グラフ X 軸ラベル帯の高さ（Recharts margin.bottom / XAxis.height と同期）。
 * 外寸 lbChart.container は固定 — プロットはこの分だけ低くなる。
 */
export const loadBalancingOverviewChartAxisBandHeight = 108;

/**
 * 俯瞰棒グラフ X 軸の描画契約。
 *
 * 座標系: Recharts の tick 原点は X 軸線上。+Y は画面下（マージン側）、-Y はプロット（棒）側。
 * レイアウト（上→下）: 資源CD（横書き）→ gapBelowResourceCd → 表示名（+90° 縦書き）。
 * 資源CD・表示名は **いずれも +Y（マージン内）**（-Y は棒と重なるため禁止）。
 */
export const loadBalancingOverviewXAxisLayout = {
  /** 軸線と tick 原点の間 — 棒グラフ下端との隙間 */
  tickMargin: 6,
  resourceCd: {
    fill: '#e2e8f0',
    fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
    textAnchor: 'middle' as const,
    /** 軸線より下・ラベル帯最上段（横書き） */
    dy: 4,
    /** 資源CD 1 行分の高さ（fontSize ベース） */
    lineHeight: 13
  },
  /** 資源CD の真下に入れる余白（表示名はこの下から開始） */
  gapBelowResourceCd: 10,
  displayName: {
    fill: '#94a3b8',
    fontSize: 10,
    textAnchor: 'middle' as const,
    /** +90° → 文字列は下方向（+Y）に伸びる */
    rotationDeg: 90,
    maxLength: 18
  }
} as const;

/** 表示名グループの Y オフセット（tick 原点からの +Y） */
export function getOverviewChartDisplayNameOffsetY(): number {
  const { resourceCd, gapBelowResourceCd } = loadBalancingOverviewXAxisLayout;
  return resourceCd.dy + resourceCd.lineHeight + gapBelowResourceCd;
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
  maxLength: number = loadBalancingOverviewXAxisLayout.displayName.maxLength
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
