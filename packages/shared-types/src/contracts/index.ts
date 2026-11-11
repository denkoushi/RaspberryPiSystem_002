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

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiListResponse<T> {
  items: T[];
  total?: number;
}

export interface ProductionScheduleAutoRankRequest {
  resourceCd: string;
  assignments: { rowId: string; orderNumber: number }[];
  targetLocation?: string;
  targetDeviceScopeKey?: string;
}

export interface ProductionScheduleAutoRankResponse {
  success: true;
  assignments: { rowId: string; orderNumber: number }[];
}
