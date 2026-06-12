/** Gmail `FKOJUNST_Status` の `FUPDTEDT` を現場 JST 壁時計として解釈する（Node/Postgres 実行 TZ に依存しない）。 */
export const FKOJUNST_STATUS_MAIL_FUPDTEDT_WALL_CLOCK_TIMEZONE = 'Asia/Tokyo';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

/** MM/DD/YYYY HH:mm:ss（FKOJUNST_Status CSV 従来） */
export const FKOJUNST_STATUS_MAIL_FUPDTEDT_US_DATETIME_SEC =
  /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

/**
 * `YYYY-MM-DDTHH:mm:ss` 系（オプションで小数秒・Z/オフセット）。日付のみは受け付けない。
 */
export const FKOJUNST_STATUS_MAIL_FUPDTEDT_ISO_DATETIME_WITH_T =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

const FKOJUNST_STATUS_MAIL_FUPDTEDT_ISO_WALL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;

const FKOJUNST_STATUS_MAIL_FUPDTEDT_ISO_PARTS =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function isValidGregorianDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function isValidTimeParts(hour: number, minute: number, second: number): boolean {
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    Number.isInteger(second) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function parseIsoFractionalMilliseconds(fraction: string | undefined): number {
  if (fraction == null || fraction.length === 0) {
    return 0;
  }
  const digits = fraction.startsWith('.') ? fraction.slice(1) : fraction;
  if (digits.length === 0) {
    return 0;
  }
  const normalized = digits.padEnd(3, '0').slice(0, 3);
  const millisecond = Number(normalized);
  return Number.isFinite(millisecond) ? millisecond : 0;
}

function isValidIsoDateTimeParts(match: RegExpMatchArray): boolean {
  const [, yyyy, mm, dd, HH, MM, ss] = match;
  return (
    isValidGregorianDateParts(Number(yyyy), Number(mm), Number(dd)) &&
    isValidTimeParts(Number(HH), Number(MM), Number(ss))
  );
}

/** JST 壁時計 → UTC `Date`（日本は DST なし）。 */
export function wallClockJstToUtcDate(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond?: number;
}): Date | null {
  if (!isValidGregorianDateParts(parts.year, parts.month, parts.day)) {
    return null;
  }
  if (!isValidTimeParts(parts.hour, parts.minute, parts.second)) {
    return null;
  }
  const millisecond = parts.millisecond ?? 0;
  if (!Number.isInteger(millisecond) || millisecond < 0 || millisecond > 999) {
    return null;
  }
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, millisecond) -
      JST_OFFSET_MS
  );
}

/**
 * Gmail `FKOJUNST_Status` の `FUPDTEDT`。
 * - 従来 US 形式 / offset なし ISO: **JST 壁時計**
 * - `Z` / 明示 offset 付き ISO: 絶対時刻（`Date.parse`）
 */
export function parseFkojunstStatusMailFupdteDt(value: unknown): Date | null {
  const s = normalizeToken(value);
  if (s.length === 0) return null;

  const us = s.match(FKOJUNST_STATUS_MAIL_FUPDTEDT_US_DATETIME_SEC);
  if (us) {
    const [, mm, dd, yyyy, HH, MM, ss] = us;
    return wallClockJstToUtcDate({
      year: Number(yyyy),
      month: Number(mm),
      day: Number(dd),
      hour: Number(HH),
      minute: Number(MM),
      second: Number(ss)
    });
  }

  if (!FKOJUNST_STATUS_MAIL_FUPDTEDT_ISO_DATETIME_WITH_T.test(s)) {
    return null;
  }

  const isoParts = s.match(FKOJUNST_STATUS_MAIL_FUPDTEDT_ISO_PARTS);
  if (!isoParts || !isValidIsoDateTimeParts(isoParts)) {
    return null;
  }

  const wallClock = s.match(FKOJUNST_STATUS_MAIL_FUPDTEDT_ISO_WALL_CLOCK);
  if (wallClock && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const [, yyyy, mm, dd, HH, MM, ss, fraction] = wallClock;
    return wallClockJstToUtcDate({
      year: Number(yyyy),
      month: Number(mm),
      day: Number(dd),
      hour: Number(HH),
      minute: Number(MM),
      second: Number(ss),
      millisecond: parseIsoFractionalMilliseconds(fraction)
    });
  }

  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}
