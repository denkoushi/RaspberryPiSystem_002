export function formatLeaderBoardRequiredMinutesLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  return `${Math.round(minutes)}分`;
}
