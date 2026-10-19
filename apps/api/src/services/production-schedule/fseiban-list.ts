export const FSEIBAN_LIST_LIMIT = 2000;

export function normalizeFseibanList(
  items: readonly string[],
  limit: number = FSEIBAN_LIST_LIMIT
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  if (limit <= 0) return normalized;
  for (const item of items) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= limit) break;
  }
  return normalized;
}
