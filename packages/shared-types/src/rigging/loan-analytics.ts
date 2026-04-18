import type { LoanAnalyticsPeriodEventRow } from '../common/index.js';

/** GET /rigging-gears/loan-analytics の応答（キオスク・管理画面共通契約） */
export interface RiggingLoanAnalyticsSummary {
  /** 未返却かつ未取消の吊具貸出ローン件数 */
  openLoanCount: number;
  /** 上記のうち返却期限が現在より前の件数（dueAt があるローンのみ判定） */
  overdueOpenCount: number;
  /** RETIRED 以外の吊具マスタ件数 */
  totalRiggingGearsActive: number;
  /** 集計期間内の持出件数（borrowedAt が期間に含まれる） */
  periodBorrowCount: number;
  /** 集計期間内の返却件数（returnedAt が期間に含まれる） */
  periodReturnCount: number;
}

export interface RiggingLoanAnalyticsMonthlyPoint {
  /** 暦月キー（例: 2026-04）。timeZone 基準の月境界 */
  yearMonth: string;
  borrowCount: number;
  returnCount: number;
}

export interface RiggingLoanAnalyticsByGearRow {
  gearId: string;
  managementNumber: string;
  name: string;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  /** 現在貸出中（未返却・未取消） */
  isOutNow: boolean;
  currentBorrowerDisplayName: string | null;
  /** ISO 8601。貸出中でない場合は null */
  dueAt: string | null;
  /** 集計期間内の当該吊具への持出件数 */
  periodBorrowCount: number;
  /** 集計期間内の当該吊具からの返却件数 */
  periodReturnCount: number;
  /** 貸出中かつ期限超過（dueAt あり） */
  openIsOverdue: boolean;
}

export interface RiggingLoanAnalyticsByEmployeeRow {
  employeeId: string;
  displayName: string;
  employeeCode: string;
  /** 現在、その従業員名義で未返却の吊具ローン件数 */
  openRiggingCount: number;
  /** 上記のうち期限超過中の件数 */
  overdueOpenRiggingCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
}

export interface RiggingLoanAnalyticsMeta {
  /** 集計の基準にした IANA タイムゾーン */
  timeZone: string;
  /** ISO 8601 期間の開始（インクルーシブ想定で API 側と揃える） */
  periodFrom: string;
  periodTo: string;
  /** 月次系列の本数 */
  monthlyMonths: number;
  generatedAt: string;
}

export interface RiggingLoanAnalyticsResponse {
  meta: RiggingLoanAnalyticsMeta;
  summary: RiggingLoanAnalyticsSummary;
  monthlyTrend: RiggingLoanAnalyticsMonthlyPoint[];
  byGear: RiggingLoanAnalyticsByGearRow[];
  periodEvents: LoanAnalyticsPeriodEventRow[];
  byEmployee: RiggingLoanAnalyticsByEmployeeRow[];
}
