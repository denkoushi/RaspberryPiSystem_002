type Example = { aiText: string; finalText: string | null };

export function buildProcedureCaptionLearningPrompt(examples: Example[]): string {
  const seen = new Set<string>();
  const candidates = examples.flatMap(row => {
    if (row.finalText === null) return [];
    const finalText = row.finalText.trim().replace(/^(?:[0-9０-９]+[.．、)）]|・)\s*/, '').trim();
    if (!finalText || /[\r\n]/.test(finalText) || Array.from(finalText).length > 30) return [];
    const key = JSON.stringify([row.aiText, finalText]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ aiText: row.aiText, finalText }];
  }).slice(0, 5);
  if (!candidates.length) return '';
  return '過去に人が直した例(呼び名と書き方の参考。個数や品名を他の写真に持ち込まない):\n'
    + candidates.map(row => `AI: ${JSON.stringify(row.aiText)} → 人: ${JSON.stringify(row.finalText)}`).join('\n') + '\n';
}
