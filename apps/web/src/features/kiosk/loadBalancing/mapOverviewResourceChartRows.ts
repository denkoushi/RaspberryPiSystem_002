import { resolveLoadBalancingResourceDisplayName } from './resolveLoadBalancingResourceDisplayName';

import type { OverviewResourceRowInput } from './loadBalancingOverviewDisplay';

export type OverviewChartRow = {
  cd: string;
  displayName: string;
  req: number;
  cap: number;
  over: number;
};

const DEFAULT_MAX_ROWS = 48;

/**
 * 俯瞰棒グラフ用行 — 必要分降順・上位 N 件（デフォルト 48）。
 * 表示名は resources API の resourceNameMap から解決（API 契約は変更しない）。
 */
export function mapOverviewResourceChartRows(
  resources: OverviewResourceRowInput[],
  resourceNameMap: Record<string, string[]>,
  maxRows: number = DEFAULT_MAX_ROWS
): OverviewChartRow[] {
  return resources
    .map((resource) => ({
      cd: resource.resourceCd,
      displayName: resolveLoadBalancingResourceDisplayName(resource.resourceCd, resourceNameMap),
      req: Math.round(resource.requiredMinutes),
      cap: resource.availableMinutes == null ? 0 : Math.round(resource.availableMinutes),
      over: Math.round(resource.overMinutes)
    }))
    .sort((a, b) => b.req - a.req)
    .slice(0, maxRows);
}
