/**
 * キオスクのプレビュー対象端末 IDから、実際に GET /signage/current-image に渡す id を決める。
 * DB 保存値が欠落・無効（サイネージ候補に無い）ならキオスク自身の端末 IDにフォールバックする。
 */
export function resolveEffectiveKioskSignagePreviewDeviceId(params: {
  kioskDeviceId: string;
  storedTarget: string | null;
  validSignageDeviceIds: Set<string>;
}): string {
  const { kioskDeviceId, storedTarget, validSignageDeviceIds } = params;
  if (storedTarget && validSignageDeviceIds.has(storedTarget)) {
    return storedTarget;
  }
  return kioskDeviceId;
}
