/** 機種名比較用: 全角→半角・前後空白除去・大文字化（フロントの toHalfWidthAscii + uppercase と同一） */
export function normalizeMachineNameForCompare(value: string | null | undefined): string {
  if (value == null) return '';
  const s = String(value).trim();
  const half = s
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
  return half.toUpperCase();
}
