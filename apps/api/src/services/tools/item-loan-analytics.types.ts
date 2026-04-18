export type ItemLoanAnalyticsTimeZone = 'Asia/Tokyo' | 'UTC';

export interface ItemLoanAnalyticsOpenLoanInfo {
  dueAt: Date | null;
  employeeDisplayName: string;
  employeeCode: string;
  isOverdue: boolean;
}

export interface ItemLoanAnalyticsItemAggregateRow {
  itemId: string;
  itemCode: string;
  name: string;
  status: string;
  periodBorrowCount: number;
  periodReturnCount: number;
  open: ItemLoanAnalyticsOpenLoanInfo | null;
}

export interface ItemLoanAnalyticsEmployeeAggregateRow {
  employeeId: string;
  displayName: string;
  employeeCode: string;
  openItemCount: number;
  overdueOpenItemCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
}

export interface ItemLoanAnalyticsQueryInput {
  periodFrom: Date;
  periodTo: Date;
  monthlyMonths: number;
  timeZone: ItemLoanAnalyticsTimeZone;
  now: Date;
  /** 写真持出の表示名キー（`itemId` 解決後に設定） */
  toolLabelFilter?: string;
}

export interface ItemLoanAnalyticsAggregate {
  monthlyTrend: Array<{ yearMonth: string; borrowCount: number; returnCount: number }>;
  periodBorrowCount: number;
  periodReturnCount: number;
  openLoanCount: number;
  overdueOpenCount: number;
  totalItemsActive: number;
  itemRows: ItemLoanAnalyticsItemAggregateRow[];
  periodEventRows: ItemLoanAnalyticsPeriodEventRow[];
  employeeRows: ItemLoanAnalyticsEmployeeAggregateRow[];
}

export interface ItemLoanAnalyticsPeriodEventRow {
  kind: 'BORROW' | 'RETURN';
  eventAt: Date;
  assetId: string;
  assetLabel: string;
  actorDisplayName: string | null;
  actorEmployeeId: string | null;
}

export interface IItemLoanAnalyticsRepository {
  loadAggregate(input: ItemLoanAnalyticsQueryInput): Promise<ItemLoanAnalyticsAggregate>;
  /** 写真持出の仮想 `itemId`（`pt-`…）から表示名キーを解決 */
  resolveSyntheticItemIdToToolLabel(syntheticId: string): Promise<string | null>;
}
