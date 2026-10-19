/** API errorCode takes precedence over the older code field. */
export function setupErrorText(error: unknown): string {
  const data = (error as { response?: { data?: { errorCode?: string; code?: string; message?: string } } })?.response?.data;
  const code = data?.errorCode ?? data?.code;
  return data?.message || code || (error instanceof Error ? error.message : '処理に失敗しました');
}
