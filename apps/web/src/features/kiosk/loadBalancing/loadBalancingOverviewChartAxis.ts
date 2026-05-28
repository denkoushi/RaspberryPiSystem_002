import type { OverviewChartRow } from './mapOverviewResourceChartRows';

/** 俯瞰棒グラフ X 軸の描画契約（Recharts カスタム tick とプレビュー HTML で共有する意味論） */
export const loadBalancingOverviewXAxisLayout = {
  resourceCd: {
    fill: '#e2e8f0',
    fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
    dy: -2
  },
  displayName: {
    fill: '#94a3b8',
    fontSize: 10,
    rotationDeg: -90,
    dx: -2,
    dy: 18,
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
