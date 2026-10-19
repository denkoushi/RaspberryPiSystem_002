export const DEFAULT_INQUIRY_REQUEST = '現場まで来てください。';
const HISTORY_KEY = 'kiosk.inquiry.request-history';
const HISTORY_LIMIT = 10;

export function readRequestHistory(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === 'string')) return [];
    return [...new Set(value.map(entry => entry.trim()).filter(entry => entry.length > 0 && entry.length <= 200))].slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveRequestHistory(request: string, history: string[]): string[] {
  const next = [...new Set([request.trim(), ...history])].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Keep history usable in this form even when browser storage is unavailable.
  }
  return next;
}
