type Example = { aiText: string; finalText: string | null };
type Term = { wrongText: string; rightText: string };

function smallEdit(before: string, after: string): boolean {
  if (before.split('\n').length !== after.split('\n').length) return false;
  const a = Array.from(before), b = Array.from(after);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] <= Math.max(a.length, b.length) / 2;
}

export function buildProcedureTextLearningPrompt(examples: Example[], terms: Term[]): string {
  const seen = new Set<string>();
  const candidates = examples.filter((row): row is Example & { finalText: string } => {
    if (row.finalText === null || Array.from(row.aiText).length > 200 || Array.from(row.finalText).length > 200) return false;
    const key = JSON.stringify([row.aiText, row.finalText]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(row => ({ ...row, small: smallEdit(row.aiText, row.finalText) }))
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
