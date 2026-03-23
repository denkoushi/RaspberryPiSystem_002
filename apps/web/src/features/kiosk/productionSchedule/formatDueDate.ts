const DUE_DATE_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

type DueDateParts = {
  month: number;
  day: number;
  /** 0=日 ... 6=土（Date#getUTCDay と同じ） */
  weekdayIndex: number;
};

/**
 * API の `YYYY-MM-DD` 接頭辞を月日・曜日へ変換する共通処理。
 * 解釈できない入力は null を返す。
 */
function tryParseDueDatePartsFromIsoPrefix(value: string | null): DueDateParts | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { month, day, weekdayIndex };
}

export const formatDueDate = (value: string | null) => {
  const parsed = tryParseDueDatePartsFromIsoPrefix(value);
  if (!parsed) return '';
  return `${parsed.month}/${parsed.day}(${DUE_DATE_WEEKDAYS[parsed.weekdayIndex]})`;
};

/**
 * 進捗一覧の納期列向け短縮フォーマット。
 * - 月日をゼロ埋めして桁幅を揃える（MM/DD）
 * - 曜日は括弧ではなく `_` 区切り（MM/DD_曜）
 */
export const formatDueDateForProgressOverview = (value: string | null): string => {
  const parsed = tryParseDueDatePartsFromIsoPrefix(value);
  if (!parsed) return '';
  const mm = String(parsed.month).padStart(2, '0');
  const dd = String(parsed.day).padStart(2, '0');
  return `${mm}/${dd}_${DUE_DATE_WEEKDAYS[parsed.weekdayIndex]}`;
};
