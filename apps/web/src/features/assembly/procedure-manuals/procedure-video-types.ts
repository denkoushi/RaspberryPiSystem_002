export type ProcedureVideoSummaryDto = {
  id: string; title: string; durationSeconds: number | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
};
export type ProcedureVideoDto = ProcedureVideoSummaryDto & {
  hasPoster: boolean; linkCount: number; errorCode: string | null; errorMessage: string | null; discardedAt: string | null;
};
export type ProcedureVideoState = 'active' | 'discarded' | 'all';
