/**
 * Loan analytics の期間イベント（持出/返却）を 3 データセットで共通利用する。
 */
export type LoanAnalyticsPeriodEventKind = 'BORROW' | 'RETURN';

export interface LoanAnalyticsPeriodEventRow {
  /** イベント種別（持出/返却） */
  kind: LoanAnalyticsPeriodEventKind;
  /** ISO 8601 */
  eventAt: string;
  /**
   * ドメインごとの資産 ID
   * - 吊具: gearId
   * - 持出返却アイテム: itemId
   * - 計測機器: instrumentId
   */
  assetId: string;
  /** UI 表示用ラベル（管理番号 + 名称など） */
  assetLabel: string;
  /** 社員表示名（取得できない場合 null） */
  actorDisplayName: string | null;
  /** 社員 ID（取得できない場合 null） */
  actorEmployeeId: string | null;
}
