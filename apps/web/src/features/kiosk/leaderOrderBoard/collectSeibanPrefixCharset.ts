/**
 * 現在の接頭辞に続けられる次の1文字だけを収集する。
 * 行き止まりの文字を出さないことで、段階的な絞り込みを分かりやすくする。
 */
export function collectNextPrefixChars(fseibans: readonly string[], prefix: string): string[] {
  const seen = new Set<string>();
  for (const s of fseibans) {
    if (!s.startsWith(prefix) || s.length <= prefix.length) continue;
    seen.add(s[prefix.length] ?? '');
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
