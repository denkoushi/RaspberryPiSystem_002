/** 書き込み成功時の任意コールバック（順位ボード端末キャッシュ等が購読） */
export type ProductionScheduleWriteSuccessListeners = {
  onOrderSuccess?: (input: { rowId: string; orderNumber: number | null }) => void;
  onNoteSuccess?: (input: { rowId: string; note: string | null }) => void;
  onDueDateSuccess?: (input: { rowId: string; dueDate: string | null }) => void;
  onCompletionSuccess?: (input: { rowId: string; rowData: Record<string, unknown> }) => void;
};
