/**
 * 資源CDの表示順序を、検索結果への出現有無で優先付けする純粋関数。
 * 登録製番がアクティブな時のみ適用し、検索結果に含まれる資源CDを左側へ寄せる。
 */

/**
 * 表示用の資源CD配列を、検索結果に含まれる資源CDを優先して並び替える。
 *
 * @param visibleResourceCds - 表示対象の資源CD配列（工程カテゴリフィルタ済み）
 * @param resourceCdsInRows - 検索結果に含まれる資源CDの一覧
 * @param isSeibanActive - 登録製番が1件以上アクティブか
 * @returns 優先並びを適用した資源CD配列（適用しない場合は入力順をそのまま返す）
 */
export function prioritizeResourceCdsByPresence(
  visibleResourceCds: string[],
  resourceCdsInRows: string[],
  isSeibanActive: boolean
): string[] {
  if (!isSeibanActive || resourceCdsInRows.length === 0) {
    return visibleResourceCds;
  }

  const prioritySet = new Set(resourceCdsInRows);
  const priority: string[] = [];
  const rest: string[] = [];

  for (const cd of visibleResourceCds) {
    if (prioritySet.has(cd)) {
      priority.push(cd);
    } else {
      rest.push(cd);
    }
  }

  return [...priority, ...rest];
}
