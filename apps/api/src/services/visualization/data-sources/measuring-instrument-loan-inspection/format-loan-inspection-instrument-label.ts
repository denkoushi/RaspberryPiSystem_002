/**
 * 計測機器点検可視化の一覧用ラベル（名称と管理番号の組み立て）。
 * 描画・集計ロジックとは独立した純関数。
 */
export function formatLoanInspectionInstrumentLabel(name: string, managementNumber: string): string {
  const trimmedName = name.trim();
  const trimmedMgmt = managementNumber.trim();

  if (!trimmedName) {
    return '';
  }
  if (!trimmedMgmt) {
    return trimmedName;
  }
  return `${trimmedName} (${trimmedMgmt})`;
}
