/** API レスポンスが 404 のとき true（存在しない ID フィルタのクリア等に使用） */
export function isNotFoundQueryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 404;
}
