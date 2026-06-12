/**
 * Gmail CSV 由来の日時文字列を用途別に解釈する。
 * PowerAutomate 変更で ISO8601 が混在するケースを吸収しつつ、既存フォーマットは維持する。
 */

export {
  FKOJUNST_STATUS_MAIL_FUPDTEDT_ISO_DATETIME_WITH_T,
  FKOJUNST_STATUS_MAIL_FUPDTEDT_US_DATETIME_SEC,
  FKOJUNST_STATUS_MAIL_FUPDTEDT_WALL_CLOCK_TIMEZONE,
  parseFkojunstStatusMailFupdteDt,
  wallClockJstToUtcDate
} from './fkojunst-status-mail-fupdtedt-parse.js';

/** `CsvDashboardIngestor` の日付列: `YYYY/M/D` または `YYYY/M/D H:M`（JST として解釈→UTC） */
const JST_SLASH_DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/;

const ISO_DATETIME_WITH_T = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

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
