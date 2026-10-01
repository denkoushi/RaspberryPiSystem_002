/**
 * 端末が最新画像（current-image）を最後に取りに来た時刻の記録。
 *
 * API プロセスのメモリだけに持つ。再起動で消えるが、端末は約 30 秒ごとに取りに来るので
 * すぐ埋まる。管理画面の「端末が受信できているか」の表示に使う。
 */
const lastFetchedAtByClientKey = new Map<string, Date>();

export function recordSignageImageFetch(clientKey: string, at: Date = new Date()): void {
  lastFetchedAtByClientKey.set(clientKey, at);
}

export function getSignageImageLastFetchedAt(clientKey: string): Date | null {
  return lastFetchedAtByClientKey.get(clientKey) ?? null;
}

export function resetSignageDeliveryTrackerForTests(): void {
  lastFetchedAtByClientKey.clear();
}
