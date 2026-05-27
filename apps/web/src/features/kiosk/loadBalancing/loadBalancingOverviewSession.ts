/** 資源CD俯瞰タブの「セッション境界」。このいずれかが変わったときだけ外注試算を破棄する。 */
export type LoadBalancingOverviewSessionContext = {
  month: string;
  scopeKey: string;
  overResourceKey: string;
};

export function buildLoadBalancingScopeKey(scopeParams: { targetDeviceScopeKey?: string }): string {
  return scopeParams.targetDeviceScopeKey?.trim() ?? '';
}

export function buildLoadBalancingOverviewSessionContext(
  month: string,
  scopeKey: string,
  overResourceKey: string
): LoadBalancingOverviewSessionContext {
  return {
    month: month.trim(),
    scopeKey,
    overResourceKey
  };
}

export function shouldResetLoadBalancingOverviewSession(
  previous: LoadBalancingOverviewSessionContext | null,
  next: LoadBalancingOverviewSessionContext
): boolean {
  if (previous == null) {
    return false;
  }
  return (
    previous.month !== next.month ||
    previous.scopeKey !== next.scopeKey ||
    previous.overResourceKey !== next.overResourceKey
  );
}
