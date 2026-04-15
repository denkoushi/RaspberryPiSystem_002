import type { LoanAnalyticsPeriodEventRow } from '../common/index.js';

/**
 * GET /tools/items/loan-analytics の応答
 *
 * 写真持出（`photoUrl` あり・`itemId` なし）の集計。工具のキーは **人レビュー表示名 > VLM 表示名 > 「撮影mode」**
 * （キオスク持出一覧の `resolvePhotoLoanToolDisplayLabel` と同順位）。NFC Item マスタ・吊具・計測・ギャラリー教師行は含めない。
 */
export interface ItemLoanAnalyticsSummary {
  openLoanCount: number;
  overdueOpenCount: number;
  totalItemsActive: number;
  periodBorrowCount: number;
  periodReturnCount: number;
}

export interface ItemLoanAnalyticsMonthlyPoint {
  yearMonth: string;
  borrowCount: number;
  returnCount: number;
}

export interface ItemLoanAnalyticsByItemRow {
  itemId: string;
  itemCode: string;
  name: string;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  isOutNow: boolean;
  currentBorrowerDisplayName: string | null;
  dueAt: string | null;
  periodBorrowCount: number;
  periodReturnCount: number;
  openIsOverdue: boolean;
}

export interface ItemLoanAnalyticsByEmployeeRow {
  employeeId: string;
  displayName: string;
  employeeCode: string;
  openItemCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
}

export interface ItemLoanAnalyticsMeta {
  timeZone: string;
  periodFrom: string;
  periodTo: string;
  monthlyMonths: number;
  generatedAt: string;
}

export interface ItemLoanAnalyticsResponse {
  meta: ItemLoanAnalyticsMeta;
  summary: ItemLoanAnalyticsSummary;
  monthlyTrend: ItemLoanAnalyticsMonthlyPoint[];
  byItem: ItemLoanAnalyticsByItemRow[];
  periodEvents: LoanAnalyticsPeriodEventRow[];
  byEmployee: ItemLoanAnalyticsByEmployeeRow[];
}
