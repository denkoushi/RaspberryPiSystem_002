export type ProcedureVideoSummaryDto = {
  id: string; title: string; durationSeconds: number | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
};
export type ProcedureVideoDto = ProcedureVideoSummaryDto & {
  origin: 'GMAIL' | 'CONCAT';
  hasPoster: boolean; linkCount: number; errorCode: string | null; errorMessage: string | null; discardedAt: string | null;
};
export type ProcedureVideoState = 'active' | 'discarded' | 'all';

export type ProcedureVideoCommentDto = { atSeconds: number; text: string };
export function procedureVideoTime(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
