export const SHARED_LOAD_BALANCING_SITE_KEY = 'shared';

export type LoadBalancingTransferRuleMergeItem = {
  fromClassCode: string;
  toClassCode: string;
  priority: number;
  enabled: boolean;
  efficiencyRatio: number;
};

export function mergeLoadBalancingItemsByResourceCd<T extends { resourceCd: string }>(
  siteItems: T[],
  sharedItems: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of sharedItems) {
    const resourceCd = item.resourceCd.trim().toUpperCase();
    if (!resourceCd) continue;
    map.set(resourceCd, { ...item, resourceCd });
  }
  for (const item of siteItems) {
    const resourceCd = item.resourceCd.trim().toUpperCase();
    if (!resourceCd) continue;
    map.set(resourceCd, { ...item, resourceCd });
  }
  return [...map.values()].sort((a, b) => a.resourceCd.localeCompare(b.resourceCd));
}

/**
 * 移管ルールのマージキー（DB unique と同じ: from + to + priority）。
 * site は同一キーでのみ shared を上書きする。from/to が同じで priority だけ異なる shared 行は残る。
 */
export function transferRuleMergeKey(rule: LoadBalancingTransferRuleMergeItem): string {
  return `${rule.fromClassCode.trim()}\t${rule.toClassCode.trim()}\t${rule.priority}`;
}

export function normalizeTransferRuleItem(
  item: LoadBalancingTransferRuleMergeItem
): LoadBalancingTransferRuleMergeItem {
  return {
    fromClassCode: item.fromClassCode.trim(),
    toClassCode: item.toClassCode.trim(),
    priority: item.priority,
    enabled: item.enabled,
    efficiencyRatio: item.efficiencyRatio
  };
}

export function mergeLoadBalancingTransferRules<T extends LoadBalancingTransferRuleMergeItem>(
  siteItems: T[],
  sharedItems: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of sharedItems) {
    const normalized = normalizeTransferRuleItem(item);
    map.set(transferRuleMergeKey(normalized), { ...item, ...normalized });
  }
  for (const item of siteItems) {
    const normalized = normalizeTransferRuleItem(item);
    map.set(transferRuleMergeKey(normalized), { ...item, ...normalized });
  }
  return [...map.values()].sort(
    (a, b) =>
      a.fromClassCode.localeCompare(b.fromClassCode) ||
      a.priority - b.priority ||
      a.toClassCode.localeCompare(b.toClassCode)
  );
}

export function usedSharedFallbackByResourceCd(siteItems: { resourceCd: string }[], merged: { resourceCd: string }[]): boolean {
  if (merged.length === 0) {
    return false;
  }
  const siteKeys = new Set(siteItems.map((item) => item.resourceCd.trim().toUpperCase()).filter(Boolean));
  return merged.some((item) => !siteKeys.has(item.resourceCd.trim().toUpperCase()));
}

export function usedSharedFallbackByTransferRule<T extends LoadBalancingTransferRuleMergeItem>(
  siteItems: T[],
  merged: T[]
): boolean {
  if (merged.length === 0) {
    return false;
  }
  const siteKeys = new Set(siteItems.map((item) => transferRuleMergeKey(normalizeTransferRuleItem(item))));
  return merged.some((item) => !siteKeys.has(transferRuleMergeKey(normalizeTransferRuleItem(item))));
}
