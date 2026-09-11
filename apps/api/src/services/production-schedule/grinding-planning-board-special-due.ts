import type { GrindingPlanningBoardSpecialDueKind } from '@raspi-system/shared-types';

import {
  DEFAULT_WORK_CALENDAR_MODE,
  formatUtcDateKey,
  isActiveWorkDay,
  parseUtcDateKey,
  type WorkCalendarMode
} from './load-balancing/work-calendar-policy.js';

const JST_OFFSET = '+09:00';

function todayJstYmd(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function jstDateTime(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}${JST_OFFSET}`);
}

export function resolveGrindingPlanningBoardSpecialDueExpiresAt(params: {
  kind: GrindingPlanningBoardSpecialDueKind;
  now?: Date;
  workCalendarMode?: WorkCalendarMode;
}): Date {
  const now = params.now ?? new Date();
  const today = parseUtcDateKey(todayJstYmd(now));
  if (params.kind === 'today') {
    return jstDateTime(formatUtcDateKey(addUtcDays(today, 1)), '00:00:00.000');
  }

  const mode = params.workCalendarMode ?? DEFAULT_WORK_CALENDAR_MODE;
  let nextBusinessDay = addUtcDays(today, 1);
  while (!isActiveWorkDay(nextBusinessDay, mode)) {
    nextBusinessDay = addUtcDays(nextBusinessDay, 1);
  }
  return jstDateTime(formatUtcDateKey(nextBusinessDay), '08:00:00.000');
}

export function isGrindingPlanningBoardSpecialDueKind(value: string | null | undefined): value is GrindingPlanningBoardSpecialDueKind {
  return value === 'today' || value === 'overnight';
}
