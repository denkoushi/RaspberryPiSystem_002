import { parseYearMonthRangeUtc } from './monthly-load-query.service.js';

const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;

export function assertYearMonthFormat(yearMonth: string): void {
  parseYearMonthRangeUtc(yearMonth);
}

export function compareYearMonth(a: string, b: string): number {
  return a.localeCompare(b);
}

export function listYearMonthsInclusive(fromMonth: string, toMonth: string): string[] {
  const from = parseYearMonthRangeUtc(fromMonth.trim());
  const to = parseYearMonthRangeUtc(toMonth.trim());
  if (from.monthStart.getTime() > to.monthStart.getTime()) {
    throw new Error('fromMonth は toMonth 以前である必要があります');
  }

  const months: string[] = [];
  let cursor = new Date(from.monthStart);
  const end = to.monthStart;
  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    months.push(`${y}-${m}`);
    cursor = new Date(Date.UTC(y, cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

export function parseYearMonthRangeInclusive(params: {
  fromMonth: string;
  toMonth: string;
  maxMonths?: number;
}): {
  fromMonth: string;
  toMonth: string;
  months: string[];
  rangeStart: Date;
  rangeEndExclusive: Date;
} {
  const fromTrimmed = params.fromMonth.trim();
  const toTrimmed = params.toMonth.trim();
  assertYearMonthFormat(fromTrimmed);
  assertYearMonthFormat(toTrimmed);

  const months = listYearMonthsInclusive(fromTrimmed, toTrimmed);
  const maxMonths = params.maxMonths ?? 12;
  if (months.length > maxMonths) {
    throw new Error(`月の範囲は最大 ${maxMonths} か月までです`);
  }

  const { monthStart: rangeStart } = parseYearMonthRangeUtc(fromTrimmed);
  const { monthEndExclusive: rangeEndExclusive } = parseYearMonthRangeUtc(toTrimmed);

  return {
    fromMonth: fromTrimmed,
    toMonth: toTrimmed,
    months,
    rangeStart,
    rangeEndExclusive
  };
}

export function formatYearMonthFromUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function parseYearMonthParts(yearMonth: string): { year: number; month: number } {
  const match = YEAR_MONTH_RE.exec(yearMonth.trim());
  if (!match) {
    throw new Error('month は YYYY-MM 形式で指定してください');
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}
