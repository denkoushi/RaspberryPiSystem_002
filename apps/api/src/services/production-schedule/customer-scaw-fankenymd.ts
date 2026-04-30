const isValidUtcDateParts = (year: number, month1Based: number, day: number): boolean => {
  const utc = Date.UTC(year, month1Based - 1, day);
  const date = new Date(utc);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month1Based - 1 &&
    date.getUTCDate() === day
  );
};

const parseDirectDateOnlyUtcDayMs = (normalized: string): number | null => {
  const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const year = Number.parseInt(iso[1]!, 10);
    const month = Number.parseInt(iso[2]!, 10);
    const day = Number.parseInt(iso[3]!, 10);
    return isValidUtcDateParts(year, month, day) ? Date.UTC(year, month - 1, day) : null;
  }

  const ymdSlash = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[T\s].*)?$/);
  if (ymdSlash) {
    const year = Number.parseInt(ymdSlash[1]!, 10);
    const month = Number.parseInt(ymdSlash[2]!, 10);
    const day = Number.parseInt(ymdSlash[3]!, 10);
    return isValidUtcDateParts(year, month, day) ? Date.UTC(year, month - 1, day) : null;
  }

  const jp = normalized.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:.*)?$/);
  if (jp) {
    const year = Number.parseInt(jp[1]!, 10);
    const month = Number.parseInt(jp[2]!, 10);
    const day = Number.parseInt(jp[3]!, 10);
    return isValidUtcDateParts(year, month, day) ? Date.UTC(year, month - 1, day) : null;
  }

  const us = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
  if (us) {
    const month = Number.parseInt(us[1]!, 10);
    const day = Number.parseInt(us[2]!, 10);
    const year = Number.parseInt(us[3]!, 10);
    return isValidUtcDateParts(year, month, day) ? Date.UTC(year, month - 1, day) : null;
  }

  return null;
};

/**
 * CustomerSCAW の `FANKENYMD` を UTC 日単位のエポック ms に正規化する。
 * まず CSV で来やすい日付だけをタイムゾーン非依存に直読みし、
 * それ以外は `Date.parse` へフォールバックしてローカル暦日を採用する。
 */
export function parseCustomerScawFankenymdUtcDayMs(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).normalize('NFKC').trim();
  if (s.length === 0) return null;

  const direct = parseDirectDateOnlyUtcDayMs(s);
  if (direct !== null) {
    return direct;
  }

  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}
