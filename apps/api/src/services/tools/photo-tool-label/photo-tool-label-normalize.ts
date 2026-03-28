/** VLM 応答からカード表示用の短い日本語名へ正規化する最大文字数 */
export const PHOTO_TOOL_DISPLAY_NAME_MAX_LEN = 48;

/**
 * モデル出力を表示用ラベルに正規化する。
 * 空・不適切な場合は null。
 */
export function normalizePhotoToolDisplayName(raw: string): string | null {
  const collapsed = raw
    .trim()
    .replace(/[\r\n]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!collapsed) {
    return null;
  }
  const clipped =
    collapsed.length > PHOTO_TOOL_DISPLAY_NAME_MAX_LEN
      ? collapsed.slice(0, PHOTO_TOOL_DISPLAY_NAME_MAX_LEN).trim()
      : collapsed;
  return clipped.length > 0 ? clipped : null;
}
