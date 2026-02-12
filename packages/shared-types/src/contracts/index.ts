/**
 * API契約型（段階導入）
 * 既存型を壊さず、共通で使うレスポンス契約を追加する。
 */

export interface ApiErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: unknown;
  statusCode?: number;
}
