import type { SchedulePartState } from '../../../api/domains/schedule-seibans';

export const scheduleDateThresholds = { urgent: 3, soon: 7 } as const;
export const scheduleStateLabels: Record<SchedulePartState, string> = { shelf: '棚にある', verified: '照合済み', pending: 'まだ', done: '完了' };
export const scheduleStateColors: Record<SchedulePartState, string> = { shelf: 'var(--hp-ok)', verified: 'var(--hp-slip)', pending: 'var(--hp-ink3)', done: 'var(--hp-line)' };

export function formatScheduleDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00+09:00`);
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))} ${new Intl.DateTimeFormat('ja-JP', { weekday: 'short', timeZone: 'Asia/Tokyo' }).format(date)}`;
}

export function scheduleDateColor(value: string | null, now = new Date()) {
  if (!value) return 'var(--hp-ink2)';
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
  const days = (Date.parse(value) - Date.parse(today)) / 86_400_000;
  return days <= scheduleDateThresholds.urgent ? 'var(--hp-ng)' : days <= scheduleDateThresholds.soon ? 'var(--hp-shelf)' : 'var(--hp-ink)';
}

export const scheduleDetailPath = (fseiban: string) => `/kiosk/mobile-placement/schedule-seibans/${encodeURIComponent(fseiban)}`;
export function scheduleVerifyPath(fseiban: string, productNo?: string) {
  const params = new URLSearchParams({ scheduleFseiban: fseiban });
  if (productNo) params.set('scheduleProductNo', productNo);
  return `/kiosk/mobile-placement?${params}`;
}
