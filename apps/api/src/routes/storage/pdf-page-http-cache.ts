import type { Stats } from 'fs';

/** 要領書/サイネージ共通の PDF ページ画像。再変換で中身が変われば mtime/size が変わり ETag も変わる。 */
export const DEFAULT_PDF_PAGE_CACHE_CONTROL =
  'public, max-age=86400, stale-while-revalidate=604800';

/**
 * If-None-Match と一致すれば 304 を返してよい（単純一致。弱タグは別表記で比較）。
 */
export function buildPdfPageEtag(stat: Pick<Stats, 'size' | 'mtimeMs'>): string {
  return `"${stat.size}-${stat.mtimeMs}"`;
}

/**
 * リクエストの If-None-Match がサーバ ETag と一致するか。
 */
export function ifNoneMatchSatisfied(ifNoneMatchHeader: string | undefined, etag: string): boolean {
  if (!ifNoneMatchHeader || !etag) return false;
  const parts = ifNoneMatchHeader.split(',').map((p) => p.trim());
  for (const part of parts) {
    if (part === '*') return true;
    if (part === etag) return true;
    const weak = part.startsWith('W/');
    const normalized = weak ? part.slice(2).trim() : part;
    if (normalized === etag) return true;
  }
  return false;
}

export function resolvePdfPageCacheControl(): string {
  const raw = process.env.PDF_PAGES_CACHE_CONTROL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_PDF_PAGE_CACHE_CONTROL;
}
