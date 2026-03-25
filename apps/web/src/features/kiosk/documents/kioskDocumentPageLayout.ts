export type KioskDocumentLayoutMode = 'single' | 'spread';

/**
 * ページURLを「1ページ1行」または「見開き2ページ1行」に分割する（API/React に依存しない）
 */
export function buildPagePairs(urls: string[], layout: KioskDocumentLayoutMode): string[][] {
  if (layout === 'single') {
    return urls.map((u) => [u]);
  }
  const pairs: string[][] = [];
  for (let i = 0; i < urls.length; i += 2) {
    pairs.push(urls.slice(i, i + 2));
  }
  return pairs;
}
