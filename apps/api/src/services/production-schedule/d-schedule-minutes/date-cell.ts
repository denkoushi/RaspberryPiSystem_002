import type ExcelJS from 'exceljs';

// Merged cells with an empty master throw when ExcelJS reads the follower's text.
export const cellText = (cell: ExcelJS.Cell): string => cell.master.text;

export const normalize = (text: string): string => text.normalize('NFKC').trim();

export function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

export function nearestDate(month: number, day: number, meetingDate: string, onAmbiguous?: () => void): string | null {
  const year = Number(meetingDate.slice(0, 4));
  const candidates = [year - 1, year, year + 1]
    .map((candidate) => calendarDate(candidate, month, day))
    .filter((date): date is string => date !== null)
    .sort((a, b) => Math.abs(Date.parse(a) - Date.parse(meetingDate)) - Math.abs(Date.parse(b) - Date.parse(meetingDate)));
  if (candidates.length > 1 && Math.abs(Math.abs(Date.parse(candidates[1]) - Date.parse(meetingDate))
    - Math.abs(Date.parse(candidates[0]) - Date.parse(meetingDate))) <= 30 * 86400000) onAmbiguous?.();
  return candidates[0] ?? null;
}

export function plausibleDate(date: string, meetingDate: string): boolean {
  const lower = new Date(meetingDate);
  const upper = new Date(meetingDate);
  lower.setUTCFullYear(lower.getUTCFullYear() - 3);
  upper.setUTCFullYear(upper.getUTCFullYear() + 3);
  return Date.parse(date) >= lower.getTime() && Date.parse(date) <= upper.getTime();
}

export function formulaWithoutResult(cell: ExcelJS.Cell): boolean {
  const value = cell.master.value;
  // ExcelJS cell.value drops falsy formula results when copying its model.
  return Boolean(value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)
    && (cell.master.result === undefined || cell.master.result === null));
}

export function readDate(cell: ExcelJS.Cell, meetingDate: string, date1904: boolean | undefined, onAmbiguous?: () => void): {
  date: string | null; marks: string[]; memo: string | null; invalid: boolean;
} {
  let value = cell.master.value;
  if (value && typeof value === 'object' && 'result' in value) value = value.result ?? null;
  const text = normalize(cellText(cell));
  const empty = { date: null, marks: [], memo: null, invalid: false };
  const checked = (date: string | null) => date && plausibleDate(date, meetingDate)
    ? { ...empty, date } : { ...empty, invalid: true };
  if (!text || text === '無し' || text === '-') return empty;
  if (/※|発注/.test(text)) return { ...empty, memo: text };
  if (value instanceof Date) {
    return checked(Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null);
  }
  if (typeof value === 'number') {
    // Excel's 1900 system includes a fictitious leap day (serial 60).
    const days = Math.floor(value);
    if (!Number.isFinite(value) || days < 20000 || (!date1904 && days === 60)) return { ...empty, invalid: true };
    const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31);
    const date = new Date(epoch + (days - (!date1904 && days > 60 ? 1 : 0)) * 86400000);
    return checked(Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null);
  }
  const match = text.match(/^(?:[^\d/]*?)?(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?:\s*\(([A-Z]+)\))?$/);
  if (!match) return { ...empty, invalid: true };
  const date = match[1] ? calendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    : nearestDate(Number(match[2]), Number(match[3]), meetingDate, onAmbiguous);
  const result = checked(date);
  return { ...result, marks: result.date ? [...(match[4] ?? '')] : [] };
}
