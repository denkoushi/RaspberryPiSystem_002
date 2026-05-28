import type { OverviewChartRow } from './mapOverviewResourceChartRows';

/**
 * 俯瞰棒グラフ X 軸の描画契約。
 *
 * 座標系: Recharts の tick 原点は X 軸線上。+Y は画面下（マージン側）、-Y はプロット（棒）側。
 * 表示名は rotationDeg=+90 で +Y に伸ばす（-90 はプロット内へ伸びて重なるため使用しない）。
 */
export const loadBalancingOverviewXAxisLayout = {
  resourceCd: {
    fill: '#e2e8f0',
    fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
    textAnchor: 'middle' as const,
    /** 軸線より上（棒側） */
    dy: -4
  },
  displayName: {
    fill: '#94a3b8',
    fontSize: 10,
    textAnchor: 'start' as const,
    /** 軸線より下へ縦書き（+90° = 時計回り → 文字列は下方向に伸びる） */
    rotationDeg: 90,
    dx: -4,
    /** 軸線直下からマージン内へ */
    dy: 12,
    maxLength: 18
  }
} as const;

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
