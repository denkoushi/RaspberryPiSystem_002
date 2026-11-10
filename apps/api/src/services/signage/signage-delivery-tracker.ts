/**
 * 端末が最新画像（current-image）を最後に取りに来た時刻の記録。
 *
 * API プロセスのメモリだけに持つ。再起動で消えるが、端末は約 30 秒ごとに取りに来るので
 * すぐ埋まる。管理画面の「端末が受信できているか」の表示に使う。
 */
const lastFetchedAtByClientDeviceId = new Map<string, Date>();

export function recordSignageImageFetch(clientDeviceId: string, at: Date = new Date()): void {
  lastFetchedAtByClientDeviceId.set(clientDeviceId, at);
}

export function getSignageImageLastFetchedAt(clientDeviceId: string): Date | null {
  return lastFetchedAtByClientDeviceId.get(clientDeviceId) ?? null;
}

export function resetSignageDeliveryTrackerForTests(): void {
  lastFetchedAtByClientDeviceId.clear();
}
