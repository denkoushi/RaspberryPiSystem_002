/**
 * 資源 CD と API の resourceNameMap を結合した表示（資源スロット UI とカードヘッダで共有）。
 */
export function formatResourceCdWithJapaneseNames(
  resourceCd: string,
  resourceNameMap: Record<string, string[]>
): string {
  const names = resourceNameMap[resourceCd] ?? [];
  return names.length > 0 ? `${resourceCd}（${names.join(' / ')}）` : resourceCd;
}
