export type ProcedureVideoAutoEditDismissInput = { suggestionId: string };
export type ProcedureVideoAutoEditApplyInput = ProcedureVideoAutoEditDismissInput & {
  comments: Array<{ atSeconds: number; text: string }>;
  scenes?: Array<{ title: string; startSeconds: number; endSeconds: number }>;
};

export type ProcedureVideoAutoEditScene = {
  title: string;
  startSeconds: number;
  endSeconds: number;
  caption: string;
  needsReview?: boolean;
};
export type ProcedureVideoAutoEditSummary = {
  status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'SKIPPED';
  decision: 'APPLIED' | 'DISMISSED' | null;
};
export type ProcedureVideoAutoEditDto = ProcedureVideoAutoEditSummary & {
  id: string;
  videoId: string;
  suggestion: {
    scenes: ProcedureVideoAutoEditScene[];
    comments: ProcedureVideoAutoEditApplyInput['comments'];
  } | null;
  confirmed: {
    scenes: NonNullable<ProcedureVideoAutoEditApplyInput['scenes']>;
    comments: ProcedureVideoAutoEditApplyInput['comments'];
  } | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
