export type MeasuringInstrumentLoanAnalyticsTimeZone = 'Asia/Tokyo' | 'UTC';

export type MeasuringInstrumentUnifiedEventAction = '持ち出し' | '返却';
export type MeasuringInstrumentUnifiedEventSource = 'nfc' | 'csv';

export interface MeasuringInstrumentUnifiedEvent {
  managementNumber: string;
  action: MeasuringInstrumentUnifiedEventAction;
  eventAt: Date;
  source: MeasuringInstrumentUnifiedEventSource;
  loanId?: string | null;
  borrowerName: string | null;
  instrumentName: string | null;
  expectedReturnAt: Date | null;
}

export interface MeasuringInstrumentLoanAnalyticsOpenInfo {
  borrowerName: string | null;
  expectedReturnAt: Date | null;
  isOverdue: boolean;
}

export interface MeasuringInstrumentLoanAnalyticsInstrumentAggregateRow {
  instrumentId: string;
  managementNumber: string;
  name: string;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  periodBorrowCount: number;
  periodReturnCount: number;
  open: MeasuringInstrumentLoanAnalyticsOpenInfo | null;
}

export interface MeasuringInstrumentLoanAnalyticsEmployeeAggregateRow {
  employeeId: string;
  displayName: string;
  employeeCode: string;
  openInstrumentCount: number;
  overdueOpenInstrumentCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
}

export interface MeasuringInstrumentLoanAnalyticsAggregate {
  monthlyTrend: Array<{ yearMonth: string; borrowCount: number; returnCount: number }>;
  periodBorrowCount: number;
  periodReturnCount: number;
  openLoanCount: number;
  overdueOpenCount: number;
  totalInstrumentsActive: number;
  instrumentRows: MeasuringInstrumentLoanAnalyticsInstrumentAggregateRow[];
  periodEventRows: MeasuringInstrumentLoanAnalyticsPeriodEventRow[];
  employeeRows: MeasuringInstrumentLoanAnalyticsEmployeeAggregateRow[];
}

export interface MeasuringInstrumentLoanAnalyticsPeriodEventRow {
  kind: 'BORROW' | 'RETURN';
  eventAt: Date;
  assetId: string;
  assetLabel: string;
  actorDisplayName: string | null;
  actorEmployeeId: string | null;
}

export interface MeasuringInstrumentLoanAnalyticsQueryInput {
  periodFrom: Date;
  periodTo: Date;
  monthlyMonths: number;
  timeZone: MeasuringInstrumentLoanAnalyticsTimeZone;
  now: Date;
  /** 指定時は当該計測機器（マスタ）のみで集計 */
  measuringInstrumentId?: string;
}

export interface IMeasuringInstrumentLoanAnalyticsRepository {
  loadAggregate(input: MeasuringInstrumentLoanAnalyticsQueryInput): Promise<MeasuringInstrumentLoanAnalyticsAggregate>;
}
