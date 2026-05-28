import { joinManualOrderResourceDisplayNames } from '../manualOrder/manualOrderOverviewCardPresentation';

/**
 * 負荷調整のチップ・棒グラフ軸用。既存 resources API の resourceNameMap を利用する。
 */
export function resolveLoadBalancingResourceDisplayName(
  resourceCd: string,
  resourceNameMap: Record<string, string[]>
): string {
  return joinManualOrderResourceDisplayNames(resourceNameMap[resourceCd]);
}
