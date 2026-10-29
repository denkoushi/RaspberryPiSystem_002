/** API errorCode takes precedence over the older code field. */
export function setupErrorText(error: unknown): string {
  const data = (error as { response?: { data?: { errorCode?: string; code?: string; message?: string } } })?.response?.data;
  const code = data?.errorCode ?? data?.code;
  return data?.message || code || (error instanceof Error ? error.message : '処理に失敗しました');
}

/** Replacement adds usage details without changing the existing API error message. */
export function setupTagErrorText(error: unknown): string {
  const used = (error as { response?: { data?: { details?: { usedBy?: { itemName: string; area: string; shelfNumber: number; drawerNumber: number } } } } })?.response?.data?.details?.usedBy;
  return used ? `このタグは「${used.itemName}」（${used.area}・棚${used.shelfNumber}・引き出し${used.drawerNumber}）で使っています。別のタグをかざしてください` : setupErrorText(error);
}
