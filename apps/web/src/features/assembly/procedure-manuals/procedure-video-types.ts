export type ProcedureVideoSummaryDto = {
  id: string; title: string; durationSeconds: number | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  hasScenePoster: boolean; sceneId: string | null; startSeconds: number | null; endSeconds: number | null;
};
export type ProcedureVideoRange = { startSeconds: number; endSeconds: number };
export type ProcedureVideoSceneDto = ProcedureVideoRange & { id: string; title: string; linkCount: number; hasScenePoster: boolean };
export type ProcedureVideoLinkItem = { videoId: string; sceneId: string | null };
export type ProcedureVideoDto = Omit<ProcedureVideoSummaryDto, 'sceneId' | 'startSeconds' | 'endSeconds' | 'hasScenePoster'> & {
  origin: 'GMAIL' | 'CONCAT';
  hasPoster: boolean; linkCount: number; sceneCount: number; errorCode: string | null; errorMessage: string | null; discardedAt: string | null;
};
export type ProcedureVideoState = 'active' | 'discarded' | 'all';

export type ProcedureVideoCommentDto = { atSeconds: number; text: string };
export function procedureVideoTime(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
