/**
 * サイネージ JPEG (`GET /api/signage/current-image`) の URL を組み立てる。
 * `<img src>` では `x-client-key` が付かないため、`key` クエリで端末識別を揃える。
 */

export function normalizeSignageApiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api';
  return base.replace(/\/$/, '');
}

export type BuildSignageCurrentImageUrlOptions = {
  /** `ClientDevice.apiKey`。未指定・空のときはクエリ `key` を付けない（後方互換・従来の単一キャッシュ） */
  clientKey?: string | null;
  /** キャッシュバスタ（ポーリング更新用） */
  cacheBust?: string | number;
};

export function buildSignageCurrentImageUrl(options: BuildSignageCurrentImageUrlOptions = {}): string {
  const normalized = normalizeSignageApiBase();
  const params = new URLSearchParams();
  const key = options.clientKey?.trim();
  if (key) {
    params.set('key', key);
  }
  if (options.cacheBust !== undefined) {
    params.set('t', String(options.cacheBust));
  }
  const qs = params.toString();
  return `${normalized}/signage/current-image${qs ? `?${qs}` : ''}`;
}
