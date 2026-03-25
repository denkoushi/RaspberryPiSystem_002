/**
 * クライアント端末の location 表示ラベルを正規化する。
 * 未設定・空白のみの場合は '-' を返す。
 */
export function formatClientDeviceLocationLabel(location: string | null | undefined): string {
  const normalized = location?.trim();
  return normalized && normalized.length > 0 ? normalized : '-';
}
