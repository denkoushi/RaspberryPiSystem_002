/**
 * 棚番表示を「接頭辞 + 末尾数字」に分ける（セル内で数字を強調するため）。
 * 末尾が数字で終わらない場合は全文を接頭辞側に載せる。
 */
export function splitShelfCodeForDisplay(raw: string): { prefix: string; num: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { prefix: '', num: '' };
  const m = trimmed.match(/^(.*?)(\d+)$/u);
  if (!m) return { prefix: trimmed, num: '' };
  return { prefix: m[1], num: m[2] };
}
