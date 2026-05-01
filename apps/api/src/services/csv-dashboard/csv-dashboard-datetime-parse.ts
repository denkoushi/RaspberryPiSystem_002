/**
 * Gmail CSV 由来の日時文字列を用途別に解釈する。
 * PowerAutomate 変更で ISO8601 が混在するケースを吸収しつつ、既存フォーマットは維持する。
 */

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

/** MM/DD/YYYY HH:mm:ss（FKOJUNST_Status CSV 従来） */
const US_DATETIME_SEC = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

/**
 * `YYYY-MM-DDTHH:mm:ss` 系（オプションで小数秒・Z/オフセット）。日付のみは受け付けない。
 */
const ISO_DATETIME_WITH_T = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** `CsvDashboardIngestor` の日付列: `YYYY/M/D` または `YYYY/M/D H:M`（JST として解釈→UTC） */
const JST_SLASH_DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/;

/**
 * Gmail `FKOJUNST_Status` の `FUPDTEDT`。
 * - 従来: `MM/DD/YYYY HH:mm:ss`（ローカル暦の成分として解釈）
 * - 拡張: `YYYY-MM-DDTHH:mm:ss[.fff][Z|±offset]`（`Date.parse`）
 */
export function parseFkojunstStatusMailFupdteDt(value: unknown): Date | null {
  const s = normalizeToken(value);
  if (s.length === 0) return null;

  const us = s.match(US_DATETIME_SEC);
  if (us) {
    const [, mm, dd, yyyy, HH, MM, ss] = us;
    const d = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(HH),
      Number(MM),
      Number(ss)
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (ISO_DATETIME_WITH_T.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  }

  return null;
}

/**
 * `dateColumnName` 指定ダッシュボード（計測機器持出など）の日時列。
 * - 従来: `YYYY/M/D` または `YYYY/M/D H:M` を **JST** とみなし UTC `Date` に変換（既存 `CsvDashboardIngestor` と同一）
 * - 拡張: ISO8601 日時（`T` あり、`Date.parse` が受理するもの）
 */
export function parseCsvDashboardDateColumnToUtc(value: string): Date | null {
  const dateValue = value.trim();
  if (dateValue.length === 0) return null;

  const slash = dateValue.match(JST_SLASH_DATE);
  if (slash) {
    const [, year, month, day, hour = '0', minute = '0'] = slash;
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10) - 1;
    const dayNum = parseInt(day, 10);
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    const utcDate = new Date(Date.UTC(yearNum, monthNum, dayNum, hourNum - 9, minuteNum, 0, 0));
    return Number.isNaN(utcDate.getTime()) ? null : utcDate;
  }

  if (ISO_DATETIME_WITH_T.test(dateValue)) {
    const t = Date.parse(dateValue);
    return Number.isNaN(t) ? null : new Date(t);
  }

  return null;
}
