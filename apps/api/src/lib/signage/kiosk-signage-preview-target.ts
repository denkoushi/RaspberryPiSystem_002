/**
 * キオスクのプレビュー対象キーから、実際に GET /signage/current-image に渡す apiKey を決める。
 * DB 保存値が欠落・無効（サイネージ候補に無い）ならキオスク自身のキーにフォールバックする。
 */
export function resolveEffectiveKioskSignagePreviewApiKey(params: {
  kioskApiKey: string;
  storedTarget: string | null;
  validSignageApiKeys: Set<string>;
}): string {
  const { kioskApiKey, storedTarget, validSignageApiKeys } = params;
  if (storedTarget && validSignageApiKeys.has(storedTarget)) {
    return storedTarget;
  }
  return kioskApiKey;
}
