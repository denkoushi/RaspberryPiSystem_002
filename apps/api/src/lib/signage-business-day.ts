const DAY_MS = 86_400_000;

/**
 * サイネージ「自動表示」用の業務日ラベル（JST）。
 * - JST 0:00〜8:59 → 暦の前日
 * - JST 9:00〜23:59 → 暦の当日
 */
export function resolveJstSignageBusinessDate(now: Date = new Date()): string {
  const calendarDate = formatJstDate(now);
  if (getJstHour(now) < 9) {
    return addJstCalendarDays(calendarDate, -1);
  }
  return calendarDate;
}

/**
 * 業務日ラベルごとの集計窓（半開区間）: [JST 当日 09:00, 翌 JST 09:00)
 */
export function resolveJstBusinessDayRange9am(effectiveDate: string): {
  date: string;
  start: Date;
  end: Date;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new Error('effectiveDateはYYYY-MM-DD形式で指定してください');
  }
  const start = new Date(`${effectiveDate}T09:00:00+09:00`);
  const nextLabel = addJstCalendarDays(effectiveDate, 1);
  const end = new Date(`${nextLabel}T09:00:00+09:00`);
  return { date: effectiveDate, start, end };
}

function getJstHour(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const raw = parts.find((p) => p.type === 'hour')?.value;
  const hour = raw != null ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(hour) ? hour : 0;
}

function addJstCalendarDays(isoDate: string, deltaDays: number): string {
  const anchor = new Date(`${isoDate}T12:00:00+09:00`);
  const shifted = new Date(anchor.getTime() + deltaDays * DAY_MS);
  return formatJstDate(shifted);
}

function formatJstDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}
