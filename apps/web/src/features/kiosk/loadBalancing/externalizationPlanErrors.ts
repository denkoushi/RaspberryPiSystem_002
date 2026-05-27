/** 推奨セット操作に関する mutation エラーを 1 件の表示用文字列にまとめる。 */
export function formatExternalizationPlanActionError(errors: {
  planError?: unknown;
  candidatesError?: unknown;
  simulateError?: unknown;
  replacementsError?: unknown;
}): string | null {
  const messages: string[] = [];
  for (const error of [
    errors.planError,
    errors.candidatesError,
    errors.simulateError,
    errors.replacementsError
  ]) {
    if (!error) continue;
    const text = error instanceof Error ? error.message : String(error);
    if (text.length > 0 && !messages.includes(text)) {
      messages.push(text);
    }
  }
  return messages.length > 0 ? messages.join(' / ') : null;
}
