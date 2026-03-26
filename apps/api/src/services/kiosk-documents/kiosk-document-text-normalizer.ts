/**
 * 検索・抽出向けの最低限正規化。
 * - 全角/半角の揺れを NFKC で縮退
 * - 連続空白を1つに圧縮
 * - 大文字小文字差を吸収
 */
export function normalizeDocumentText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
