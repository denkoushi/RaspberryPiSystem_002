/** VLM 応答からカード表示用の短い日本語名へ正規化する最大文字数 */
export const PHOTO_TOOL_DISPLAY_NAME_MAX_LEN = 48;

export type NormalizePhotoToolDisplayNameOptions = {
  /**
   * true のとき、先頭の説明文っぽい区切り（。等）より前だけを採用し、末尾の区切りを除去する。
   * 初見 strict モード専用（assist 収束 canonical 等では使わない）。
   */
  strict?: boolean;
};

/**
 * モデル出力を表示用ラベルに正規化する。
 * 空・不適切な場合は null。
 */
export function normalizePhotoToolDisplayName(
  raw: string,
  options?: NormalizePhotoToolDisplayNameOptions
): string | null {
  let collapsed = raw
    .trim()
    .replace(/[\r\n]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (options?.strict) {
    const periodChars = ['。', '．', '.'] as const;
    let cut = collapsed.length;
    for (const ch of periodChars) {
      const i = collapsed.indexOf(ch);
      if (i !== -1 && i < cut) {
        cut = i;
      }
    }
    if (cut < collapsed.length && cut > 0) {
      collapsed = collapsed.slice(0, cut).trim();
    }
    collapsed = collapsed.replace(/[:：]\s*$/u, '').trim();
  }

  if (!collapsed) {
    return null;
  }
  const clipped =
    collapsed.length > PHOTO_TOOL_DISPLAY_NAME_MAX_LEN
      ? collapsed.slice(0, PHOTO_TOOL_DISPLAY_NAME_MAX_LEN).trim()
      : collapsed;
  return clipped.length > 0 ? clipped : null;
}
