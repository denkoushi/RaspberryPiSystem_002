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

/** UTC のカレンダー演算で、月/日をホストの DST に依存せず移動する。 */
export function shiftPeriod(period: string, delta: number): string {
  const value = period.trim();
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match || !Number.isInteger(delta) || !periodRangeToIso(value)) return period;
  const date = new Date(`${match[1]}-${match[2]}-${match[3] ?? '01'}T00:00:00Z`);
  if (match[3]) date.setUTCDate(date.getUTCDate() + delta);
  else date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, match[3] ? 10 : 7);
}

/** 今月/今日以降はステッパーを進めない。 */
export function isLatestPeriod(period: string, now: Date): boolean {
  if (!periodRangeToIso(period)) return true;
  // 端末のタイムゾーンによらず、日本時間の今日/今月と比べる。
  const todayJst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
  return period.trim() >= (period.trim().length === 10 ? todayJst : todayJst.slice(0, 7));
}

export function formatShortPeriodLabel(period: string): string {
  const [, month, day] = period.split('-').map(Number);
  return day ? `${month}/${day}` : `${month}月`;
}

export function formatTimeJa(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function formatDueDateJa(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit' });
}
