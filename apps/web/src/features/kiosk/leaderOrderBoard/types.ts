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
  processingOrder: number | null;
};
