/** 許可された暦月境界（SQL インジェクション防止のため列挙のみ） */
export type RiggingLoanAnalyticsTimeZone = 'Asia/Tokyo' | 'UTC';

/** Repository が Service に返す内部集計（Prisma 行の寄せ集め） */
export interface RiggingLoanAnalyticsAggregate {
  monthlyTrend: Array<{ yearMonth: string; borrowCount: number; returnCount: number }>;
  periodBorrowCount: number;
  periodReturnCount: number;
  openLoanCount: number;
  overdueOpenCount: number;
  totalRiggingGearsActive: number;
  gearRows: RiggingLoanAnalyticsGearAggregateRow[];
  periodEventRows: RiggingLoanAnalyticsPeriodEventRow[];
  employeeRows: RiggingLoanAnalyticsEmployeeAggregateRow[];
}

export interface RiggingLoanAnalyticsPeriodEventRow {
  kind: 'BORROW' | 'RETURN';
  eventAt: Date;
  assetId: string;
  assetLabel: string;
  actorDisplayName: string | null;
  actorEmployeeId: string | null;
}

export interface RiggingLoanAnalyticsOpenLoanInfo {
  dueAt: Date | null;
  employeeDisplayName: string;
  employeeCode: string;
  isOverdue: boolean;
}

export interface RiggingLoanAnalyticsGearAggregateRow {
  gearId: string;
  managementNumber: string;
  name: string;
  status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  periodBorrowCount: number;
  periodReturnCount: number;
  open: RiggingLoanAnalyticsOpenLoanInfo | null;
}

export interface RiggingLoanAnalyticsEmployeeAggregateRow {
  employeeId: string;
  displayName: string;
  employeeCode: string;
  openRiggingCount: number;
  overdueOpenRiggingCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
}

export interface RiggingLoanAnalyticsQueryInput {
  periodFrom: Date;
  periodTo: Date;
  monthlyMonths: number;
  timeZone: RiggingLoanAnalyticsTimeZone;
  /** 期限超過判定・open 件数の基準時刻（テスト用に注入可能） */
  now: Date;
  /** 指定時は当該吊具のみで集計 */
  riggingGearId?: string;
}

/** Repository の契約（Service は具象 Prisma に依存しない） */
export interface IRiggingLoanAnalyticsRepository {
  loadAggregate(input: RiggingLoanAnalyticsQueryInput): Promise<RiggingLoanAnalyticsAggregate>;
}
