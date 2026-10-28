const DAY_MS = 86_400_000;
export type ExchangeState = 'overdue' | 'soon' | 'ok' | 'unknown' | 'none';

export function normalizeCycle(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toUpperCase();
}

export function parseCycle(value: string | null | undefined): { amount: number; unit: 'D' | 'W' | 'M' | 'Y' } | null {
  const normalized = normalizeCycle(value);
  if (normalized === '毎日') return { amount: 1, unit: 'D' };
  if (/^半年(?:に)?1回$/.test(normalized)) return { amount: 6, unit: 'M' };
  const match = normalized.match(/^(\d+)(D|W|M|Y|日|週|ヶ月|か月|カ月|ヵ月|月|年)$/)
    ?? normalized.match(/^(\d*)(日|週|ヶ月|か月|カ月|ヵ月|月|年)(?:に)?1回$/);
  if (!match) return null;
  const amount = Number(match[1] || 1);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const units: Record<string, 'D' | 'W' | 'M' | 'Y'> = {
    D: 'D', 日: 'D', W: 'W', 週: 'W', M: 'M', ヶ月: 'M', か月: 'M', カ月: 'M', ヵ月: 'M', 月: 'M', Y: 'Y', 年: 'Y',
  };
  return { amount, unit: units[match[2]] };
}

export function formatCyclePill(value: string | null | undefined): string {
  const parsed = parseCycle(value);
  return parsed ? `${parsed.amount === 1 ? '' : parsed.amount}${parsed.unit}` : normalizeCycle(value);
}

export function jstDate(date: Date): string {
  return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function exchangeDates(last: Date, cycle: string | null, today: Date) {
  const lastDate = jstDate(last);
  const parsed = parseCycle(cycle);
  const unknown = { lastDate, nextDate: null, remainingDays: null, state: 'unknown' as ExchangeState };
  if (!parsed) return unknown;
  // UTC is used as a calendar-only representation of a JST date (no host timezone dependency).
  const next = new Date(`${lastDate}T00:00:00Z`);
  if (parsed.unit === 'M' || parsed.unit === 'Y') {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + parsed.amount * (parsed.unit === 'Y' ? 12 : 1));
    const monthEnd = new Date(next.getTime());
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    next.setUTCDate(Math.min(day, monthEnd.getUTCDate()));
  } else {
    next.setUTCDate(next.getUTCDate() + parsed.amount * (parsed.unit === 'W' ? 7 : 1));
  }
  if (!Number.isFinite(next.getTime()) || next.getUTCFullYear() > 9999) return unknown;
  const nextDate = next.toISOString().slice(0, 10);
  const remainingDays = Math.round((next.getTime() - Date.parse(`${jstDate(today)}T00:00:00Z`)) / DAY_MS);
  const state: ExchangeState = remainingDays < 0 ? 'overdue' : remainingDays <= 30 ? 'soon' : 'ok';
  return { lastDate, nextDate, remainingDays, state };
}
