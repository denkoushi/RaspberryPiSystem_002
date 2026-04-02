export type LeaderBoardRow = {
  id: string;
  resourceCd: string;
  dueDate: string | null;
  plannedEndDate: string | null;
  /** `resolveDisplayDueDate(dueDate, plannedEndDate)` の結果（ソート・表示用） */
  displayDue: string | null;
  fseiban: string;
  productNo: string;
  fkojun: string;
  fhincd: string;
  fhinmei: string;
  /** MH/SH 行由来の機種表示名（部品行は同一製番から解決） */
  machineName: string;
  /** rowData の機種記号列（例: DAD3350）。`resolveMachineTypeCodeFromRowData` 参照 */
  machineTypeCode: string;
  plannedQuantity: number | null;
  processingOrder: number | null;
  /** `rowData.progress === '完了'` と API 完了フラグの同期表示 */
  isCompleted: boolean;
  /** 行単位の備考（生産スケジュール API の note と同一） */
  note: string | null;
};
