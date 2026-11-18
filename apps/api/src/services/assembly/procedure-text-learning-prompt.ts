type Example = { aiText: string; finalText: string | null };
type Term = { wrongText: string; rightText: string };

export function characterEditDistance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

export function smallEdit(before: string, after: string): boolean {
  if (before.split('\n').length !== after.split('\n').length) return false;
  const a = Array.from(before), b = Array.from(after);
  return characterEditDistance(a, b) <= Math.max(a.length, b.length) / 2;
}

/** Keeps rows whose two texts are both at most 200 characters, dropping repeated pairs. */
export function uniqueShortTextPairs<T>(rows: Iterable<T>, texts: (row: T) => readonly [string, string] | null): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    const pair = texts(row);
    if (!pair || pair.some(text => Array.from(text).length > 200)) continue;
    const key = JSON.stringify(pair);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

export function buildProcedureTextLearningPrompt(examples: Example[], terms: Term[]): string {
  const resolved = examples.flatMap(row => row.finalText === null ? [] : [{ ...row, finalText: row.finalText }]);
  const candidates = uniqueShortTextPairs(resolved, row => [row.aiText, row.finalText])
    .map(row => ({ ...row, small: smallEdit(row.aiText, row.finalText) }))
    .sort((a, b) => Number(b.small) - Number(a.small)).slice(0, 5);
  let result = '';
  if (candidates.length) {
    result += '過去に人が直した書き方(書き方の参考。中の数値や品名を他の text に持ち込まない):\n';
    result += candidates.map(row => `AI: ${JSON.stringify(row.aiText)} → 人: ${JSON.stringify(row.finalText)}`).join('\n') + '\n';
  }
  if (terms.length) {
    result += '人の直しから覚えた言い直し:\n';
    result += terms.map(term => `「${term.wrongText}」→「${term.rightText}」`).join('\n') + '\n';
  }
  return result;
}
