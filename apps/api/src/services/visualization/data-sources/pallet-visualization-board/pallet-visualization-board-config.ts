/**
 * Parses `dataSourceConfig` for pallet visualization board dashboards.
 * - `machineCds` omitted, invalid, or empty array → no filter (all registered machines).
 * - Non-empty `machineCds` → restrict to those codes, intersected with registered order on the server.
 */
export function parsePalletBoardMachineCdsFromConfig(config: Record<string, unknown>): string[] | undefined {
  const raw = config.machineCds;
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const cd = entry.trim().toUpperCase();
    if (!cd || seen.has(cd)) {
      continue;
    }
    seen.add(cd);
    normalized.push(cd);
  }
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized;
}
