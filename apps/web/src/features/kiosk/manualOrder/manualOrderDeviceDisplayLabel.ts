/**
 * 手動順番上ペインの端末カード見出し用。工場ドロップダウンと重複する site プレフィックスを落とす。
 */
export function stripSitePrefixFromDeviceLabel(siteKey: string, label: string): string {
  const site = siteKey.trim();
  const trimmed = label.trim();
  if (!site || !trimmed) {
    return trimmed;
  }
  const prefix = `${site} - `;
  if (trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length).trim() || trimmed;
  }
  return trimmed;
}
