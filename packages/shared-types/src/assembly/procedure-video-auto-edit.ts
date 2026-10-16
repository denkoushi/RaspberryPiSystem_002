export type ProcedureVideoAutoEditDismissInput = { suggestionId: string };
export type ProcedureVideoAutoEditApplyInput = ProcedureVideoAutoEditDismissInput & {
  comments: Array<{ atSeconds: number; text: string }>;
  scenes?: Array<{ title: string; startSeconds: number; endSeconds: number }>;
};
