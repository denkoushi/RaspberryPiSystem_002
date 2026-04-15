export function formatYearMonthJa(ym: string): string {
  const [y, m] = ym.split('-').map((s) => Number(s));
  if (!y || !m) return ym;
  return `${y}年${m}月`;
}

/** `YYYY-MM` または `YYYY-MM-DD` */
export function formatPeriodLabelJa(period: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period.trim());
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)) {
      return `${y}年${mo}月${d}日`;
    }
  }
  return formatYearMonthJa(period);
}

export function formatDateTimeJa(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

export function toMonthInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function toDayInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function periodRangeToIso(periodValue: string): { periodFrom: string; periodTo: string } | null {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodValue.trim());
  if (dayMatch) {
    const y = Number(dayMatch[1]);
    const mo = Number(dayMatch[2]);
    const d = Number(dayMatch[3]);
    const check = new Date(y, mo - 1, d);
    if (
      !Number.isFinite(y) ||
      !Number.isFinite(mo) ||
      !Number.isFinite(d) ||
      check.getFullYear() !== y ||
      check.getMonth() !== mo - 1 ||
      check.getDate() !== d
    ) {
      return null;
    }
    const start = new Date(`${dayMatch[1]}-${dayMatch[2]}-${dayMatch[3]}T00:00:00+09:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { periodFrom: start.toISOString(), periodTo: end.toISOString() };
  }

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(periodValue.trim());
  if (!monthMatch) return null;
  const year = Number(monthMatch[1]);
  const monthIndex = Number(monthMatch[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  const start = new Date(`${monthMatch[1]}-${monthMatch[2]}-01T00:00:00+09:00`);
  const nextMonth = monthIndex === 11 ? `${year + 1}-01` : `${monthMatch[1]}-${String(monthIndex + 2).padStart(2, '0')}`;
  const end = new Date(`${nextMonth}-01T00:00:00+09:00`);
  end.setMilliseconds(end.getMilliseconds() - 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { periodFrom: start.toISOString(), periodTo: end.toISOString() };
}
