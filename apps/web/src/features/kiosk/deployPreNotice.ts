export const DEPLOY_PRE_NOTICE_MESSAGE =
  'この端末は1分後に更新を開始します。作業内容を保存し、操作を終了してください。';

export function remainingDeployNoticeSeconds(scheduledAt: string | undefined, now = Date.now()): number | null {
  if (!scheduledAt) return null;
  const timestamp = Date.parse(scheduledAt);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - now) / 1000));
}

export function formatDeployNoticeCountdown(remainingSeconds: number | null): string {
  if (remainingSeconds === null) return '開始時刻を確認しています';
  if (remainingSeconds === 0) return 'まもなく更新を開始します';
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `更新開始まで ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
