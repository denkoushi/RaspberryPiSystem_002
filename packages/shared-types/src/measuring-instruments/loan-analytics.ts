import type { LoanAnalyticsPeriodEventRow } from '../common/index.js';

/** GET /measuring-instruments/loan-analytics の応答 */
export interface MeasuringInstrumentLoanAnalyticsSummary {
  openLoanCount: number;
  overdueOpenCount: number;
  totalInstrumentsActive: number;
  periodBorrowCount: number;
  periodReturnCount: number;
}

export interface MeasuringInstrumentLoanAnalyticsMonthlyPoint {
  yearMonth: string;
  borrowCount: number;
  returnCount: number;
}

export interface MeasuringInstrumentLoanAnalyticsByInstrumentRow {
  instrumentId: string;
  managementNumber: string;
  name: string;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  isOutNow: boolean;
  currentBorrowerDisplayName: string | null;
  dueAt: string | null;
  periodBorrowCount: number;
  periodReturnCount: number;
  openIsOverdue: boolean;
}

export interface MeasuringInstrumentLoanAnalyticsByEmployeeRow {
  employeeId: string;
  displayName: string;
  employeeCode: string;
  openInstrumentCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
}

export interface MeasuringInstrumentLoanAnalyticsMeta {
  timeZone: string;
  periodFrom: string;
  periodTo: string;
  monthlyMonths: number;
  generatedAt: string;
}

export interface MeasuringInstrumentLoanAnalyticsResponse {
  meta: MeasuringInstrumentLoanAnalyticsMeta;
  summary: MeasuringInstrumentLoanAnalyticsSummary;
  monthlyTrend: MeasuringInstrumentLoanAnalyticsMonthlyPoint[];
  byInstrument: MeasuringInstrumentLoanAnalyticsByInstrumentRow[];
  periodEvents: LoanAnalyticsPeriodEventRow[];
  byEmployee: MeasuringInstrumentLoanAnalyticsByEmployeeRow[];
}
