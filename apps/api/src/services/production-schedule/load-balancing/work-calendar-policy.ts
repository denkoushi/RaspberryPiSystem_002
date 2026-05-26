export const WORK_CALENDAR_MODES = ['weekdays', 'calendar_days'] as const;

export type WorkCalendarMode = (typeof WORK_CALENDAR_MODES)[number];

export const DEFAULT_WORK_CALENDAR_MODE: WorkCalendarMode = 'weekdays';

export function normalizeWorkCalendarMode(value: string | null | undefined): WorkCalendarMode {
  const trimmed = String(value ?? '').trim();
  if (trimmed === 'calendar_days') {
    return 'calendar_days';
  }
  return 'weekdays';
}

export function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseUtcDateKey(dateKey: string): Date {
  const trimmed = dateKey.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error('date は YYYY-MM-DD 形式で指定してください');
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    throw new Error('date は YYYY-MM-DD 形式で指定してください');
  }
  return parsed;
}

export function isActiveWorkDay(date: Date, mode: WorkCalendarMode): boolean {
  if (mode === 'calendar_days') {
    return true;
  }
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

export function listActiveDaysInclusive(start: Date, end: Date, mode: WorkCalendarMode): Date[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (startMs > endMs) {
    return [];
  }

  const days: Date[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cursor.getTime() <= endDay.getTime()) {
    if (isActiveWorkDay(cursor, mode)) {
      days.push(new Date(cursor));
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
  }
  return days;
}

export function countActiveDaysInMonth(yearMonth: string, mode: WorkCalendarMode): number {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!match) {
    throw new Error('yearMonth は YYYY-MM 形式で指定してください');
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return listActiveDaysInclusive(start, end, mode).length;
}

export function listActiveDayKeysInMonth(yearMonth: string, mode: WorkCalendarMode): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!match) {
    throw new Error('yearMonth は YYYY-MM 形式で指定してください');
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return listActiveDaysInclusive(start, end, mode).map(formatUtcDateKey);
}
