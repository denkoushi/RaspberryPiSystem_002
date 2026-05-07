/**
 * 順位ボード段階取得の snapshot が指すフィルタ条件の同一性を検証するための指紋。
 * 正規化してソート順を固定し、JSON 一本化で比較する。
 */
export function buildLeaderboardShellFilterFingerprint(input: {
  locationKey: string;
  siteKey?: string;
  queryText: string;
  productNos: readonly string[];
  machineName?: string;
  resourceCds: readonly string[];
  assignedOnlyCds: readonly string[];
  resourceCategory?: 'grinding' | 'cutting';
  hasNoteOnly: boolean;
  hasDueDateOnly: boolean;
  allowResourceOnly: boolean;
}): string {
  const normalized = {
    locationKey: input.locationKey.trim(),
    siteKey: (input.siteKey ?? '').trim(),
    queryText: input.queryText.trim(),
    productNos: [...input.productNos].map((s) => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja')),
    machineName: (input.machineName ?? '').trim(),
    resourceCds: [...input.resourceCds].map((s) => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja')),
    assignedOnlyCds: [...input.assignedOnlyCds]
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ja')),
    resourceCategory: input.resourceCategory ?? '',
    hasNoteOnly: input.hasNoteOnly,
    hasDueDateOnly: input.hasDueDateOnly,
    allowResourceOnly: input.allowResourceOnly
  };
  return JSON.stringify(normalized);
}
