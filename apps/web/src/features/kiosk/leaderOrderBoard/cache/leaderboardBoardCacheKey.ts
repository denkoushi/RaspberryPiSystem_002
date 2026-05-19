/** IndexedDB キー: 工場 + 検索条件（boardQueryParams の paramsKey） */
export function buildLeaderboardBoardCacheKey(siteKey: string, paramsKey: string): string {
  const site = siteKey.trim();
  const params = paramsKey.trim();
  if (site.length === 0 && params.length === 0) return '';
  if (site.length === 0) return params;
  if (params.length === 0) return site;
  return `${site}\u0001${params}`;
}
