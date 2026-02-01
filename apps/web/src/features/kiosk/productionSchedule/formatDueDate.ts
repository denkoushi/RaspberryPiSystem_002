const DUE_DATE_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export const formatDueDate = (value: string | null) => {
  if (!value) return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return '';
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${month}/${day}(${DUE_DATE_WEEKDAYS[weekday]})`;
};
