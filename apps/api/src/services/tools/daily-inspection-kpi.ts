/**
 * 加工機「日次点検状況」KPIの判定（サイネージカードの青/赤と同じ基準）。
 *
 * - 点検済み: normalCount>0 または abnormalCount>0（カードが青/赤になる条件）
 * - それ以外: 未点検（未使用・0/0 グレーと一致）
 *
 * `machines[].used`（当日CSV行の有無）とは独立。used は並び順等の互換のため維持。
 */
export function isDailyInspectionKpiInspected(normalCount: number, abnormalCount: number): boolean {
  return normalCount > 0 || abnormalCount > 0;
}
