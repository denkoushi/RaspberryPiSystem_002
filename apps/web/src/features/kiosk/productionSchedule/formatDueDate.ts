const DUE_DATE_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

type DueDateParts = {
  month: number;
  day: number;
  /** 0=日 … 6=土（`Date#getUTCDay` と同じ） */
  weekdayIndex: number;
};

/**
 * API の `YYYY-MM-DD` 接頭辞から月日・曜を解決する（表示フォーマット用の共通処理）。
 * 解釈不能時は null。
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
 * 進捗一覧の納期列用。MM/DD をゼロ埋めして桁幅を揃え、曜日は `_` 区切り（括弧より短く列幅を抑える）。
 * 他画面の `formatDueDate` とは別契約（キオスク進捗一覧に閉じる）。
 */
export const formatDueDateForProgressOverview = (value: string | null): string => {
  const parsed = tryParseDueDatePartsFromIsoPrefix(value);
  if (!parsed) return '';
  const mm = String(parsed.month).padStart(2, '0');
  const dd = String(parsed.day).padStart(2, '0');
  return `${mm}/${dd}_${DUE_DATE_WEEKDAYS[parsed.weekdayIndex]}`;
};
