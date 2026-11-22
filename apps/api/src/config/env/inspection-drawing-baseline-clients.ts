/** Allowlist entry for INSPECTION_DRAWING_BASELINE_PLACEMENT_CLIENTS that lets every caller see baseline-v1 proposals. */
export const BASELINE_PLACEMENT_ALL_CLIENTS = '*';

type BaselineAllowlist = readonly string[] | undefined;

function configured(allowed: BaselineAllowlist): allowed is readonly string[] {
  return Array.isArray(allowed) && allowed.length > 0;
}

/** True when the caller's device identifiers must be looked up to decide (a non-empty allowlist without `*`). */
export function baselinePlacementNeedsClientIdentity(allowed: BaselineAllowlist): boolean {
  return configured(allowed) && !allowed.includes(BASELINE_PLACEMENT_ALL_CLIENTS);
}

/** True when the allowlist holds `*`, or one of the caller's device identifiers is on it. */
export function baselinePlacementAllowed(allowed: BaselineAllowlist, clientIdentifiers: readonly string[] | undefined): boolean {
  if (!configured(allowed)) return false;
  return allowed.includes(BASELINE_PLACEMENT_ALL_CLIENTS) || (clientIdentifiers ?? []).some((id) => allowed.includes(id));
}
