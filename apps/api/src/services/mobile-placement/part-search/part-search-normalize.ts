/** ILIKE パターン内で `%` `_` `\` をエスケープ（`ESCAPE '\\'` 前提） */
export function escapeForIlike(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
