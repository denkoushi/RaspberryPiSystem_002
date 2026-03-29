/**
 * VLM ユーザー文の組み立て。補助文は画像優先を明示し、誤誘導リスクを抑える。
 */
export function buildShadowAssistedUserPrompt(baseUserPrompt: string, candidateLabels: string[]): string {
  const uniq = [...new Set(candidateLabels.map((s) => s.trim()).filter(Boolean))];
  if (uniq.length === 0) {
    return baseUserPrompt;
  }
  const list = uniq.join('、');
  return `${baseUserPrompt}

【参考】工場内で確定済み（人レビュー GOOD）の類似写真に付いた工具名の例です。誤りや別物の可能性があります。必ず画像を最優先し、参考は補助に留めてください: ${list}`;
}
