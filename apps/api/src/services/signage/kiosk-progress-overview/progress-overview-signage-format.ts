import { env } from '../../../config/env.js';

const DUE_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function calendarDatePartsInTimeZone(d: Date, timeZone: string): { y: number; m: number; day: number } {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [yStr, mStr, dStr] = s.split('-');
  return { y: Number(yStr), m: Number(mStr), day: Number(dStr) };
}

function yyyymmddInTz(d: Date, tz: string): number {
  const { y, m, day } = calendarDatePartsInTimeZone(d, tz);
  return y * 10000 + m * 100 + day;
}

export function isProgressDueOverdueForSignage(due: Date | null): boolean {
  if (!due) return false;
  const tz = env.SIGNAGE_TIMEZONE;
  return yyyymmddInTz(due, tz) < yyyymmddInTz(new Date(), tz);
}

export function formatDueDateForProgressSignage(due: Date | null): string {
  if (!due) return '';
  const tz = env.SIGNAGE_TIMEZONE;
  const { y, m, day } = calendarDatePartsInTimeZone(due, tz);
  const weekdayIndex = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  const mm = String(m).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${mm}/${dd}_${DUE_WEEKDAYS[weekdayIndex]}`;
}

const MAX_MACHINE_CHARS = 36;

export function normalizeMachineNameForSignage(value: string | null | undefined): string {
  const normalized = (value?.trim() ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toUpperCase();
  if (normalized.length <= MAX_MACHINE_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_MACHINE_CHARS)}...`;
}
