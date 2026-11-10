import type { LoadBalancingWorkspaceSource } from './load-balancing-workspace-source-cache.js';
import type { LoadBalancingWorkspaceResult } from './load-balancing-workspace.types.js';

// Source identity already separates generation, scope, day, due source and month range.
// Weak keys tie these large derived values to the bounded source cache's lifetime.
const results = new WeakMap<LoadBalancingWorkspaceSource, { settingsKey: string; result: LoadBalancingWorkspaceResult }>();
const serialized = new WeakMap<LoadBalancingWorkspaceResult, string>();

export function readLoadBalancingWorkspaceResultWithCache(params: {
  source: LoadBalancingWorkspaceSource;
  settingsKey: string;
  assemble: () => LoadBalancingWorkspaceResult;
}): LoadBalancingWorkspaceResult {
  const cached = results.get(params.source);
  if (cached?.settingsKey === params.settingsKey) return cached.result;
  const result = params.assemble();
  results.set(params.source, { settingsKey: params.settingsKey, result });
  return result;
}

/** Fastify still runs its normal compression and response hooks. */
export function serializeLoadBalancingWorkspace(result: LoadBalancingWorkspaceResult): string {
  let body = serialized.get(result);
  if (body === undefined) {
    body = JSON.stringify(result);
    serialized.set(result, body);
  }
  return body;
}
