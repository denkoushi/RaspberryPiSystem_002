export type LeaderBoardRow = {
  id: string;
  /** progress-overview の製番単位集約と結ぶ専用キー。 */
  seibanJoinKey: string;
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
  /** CustomerSCAW 由来。無い場合は空 */
  customerName: string;
  /** MH/SH 行由来の機種表示名（部品行は同一製番から解決） */
  machineName: string;
  /** rowData の機種記号列（例: DAD3350）。`resolveMachineTypeCodeFromRowData` 参照 */
  machineTypeCode: string;
  plannedQuantity: number | null;
  processingOrder: number | null;
  /** `rowData.progress === '完了'` と API 完了フラグの同期表示 */
  isCompleted: boolean;
  /** slot `+人` 適用後の表示用分数（分）。ガント行高・所要時間表示。 */
  requiredMinutes: number;
  /** 機械行 FSIGENSHOYORYO（分）。不変。 */
  machineRequiredMinutes: number;
  /** 同一 ProductNo + FKOJUN の FSIGENCD=10 人工数（分）。不変。 */
  laborRequiredMinutes: number;
  /** 行単位の備考（生産スケジュール API の note と同一） */
  note: string | null;
  hasSelfInspectionDrawing: boolean;
  selfInspectionTemplateId: string | null;
  selfInspectionStatus: 'not_started' | 'in_progress' | 'completed' | null;
  selfInspectionEntryPath: string | null;
};
