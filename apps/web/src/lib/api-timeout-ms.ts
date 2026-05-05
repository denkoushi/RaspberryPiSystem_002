/** axios 共通 timeout（ミリ秒）。VITE_API_TIMEOUT_MS で上書き可。長時間処理（インポート等）との兼ね合いで既定は控えめに長め。 */
const FALLBACK_MS = 120_000;

/**
 * アプリ共通の HTTP タイムアウト（axios `timeout`）を読む。
 * 5〜600 秒相当の範囲のみ受理し、それ以外はフォールバック。
 */
export function readViteApiTimeoutMs(): number {
  const raw = import.meta.env.VITE_API_TIMEOUT_MS;
  if (raw === undefined || raw === '') {
    return FALLBACK_MS;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return FALLBACK_MS;
  }
  const clamped = Math.min(600_000, Math.max(5000, Math.floor(n)));
  return clamped;
}
