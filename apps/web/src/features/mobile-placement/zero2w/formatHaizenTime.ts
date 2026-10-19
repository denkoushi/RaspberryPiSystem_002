/** Relative within the last hour; otherwise the device's local clock time. */
export function formatHaizenTime(updatedAt: string, now = Date.now()): string {
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return '—';
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}分前`;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
