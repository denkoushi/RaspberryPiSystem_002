export function formatYearMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** 当月を含む6か月（開始月〜終了月） */
export function defaultMachineMonthlyRange(reference: Date = new Date()): { fromMonth: string; toMonth: string } {
  const fromMonth = formatYearMonth(reference);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 5, 1);
  const toMonth = formatYearMonth(end);
  return { fromMonth, toMonth };
}

export function isValidYearMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value.trim());
}
