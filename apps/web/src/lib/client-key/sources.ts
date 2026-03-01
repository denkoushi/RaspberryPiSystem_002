import { CLIENT_KEY_CONFIG } from './config';

const isValidClientKeyPrefix = (value: string): boolean => value.startsWith(CLIENT_KEY_CONFIG.keyPrefix);

const normalizeRawKey = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return isValidClientKeyPrefix(trimmed) ? trimmed : null;
};

export function getClientKeyFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('clientKey');
  if (!raw) return null;
  return normalizeRawKey(raw);
}

export function getClientKeyFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(CLIENT_KEY_CONFIG.storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return parsed.trim().length > 0 ? parsed.trim() : null;
    }
  } catch {
    // JSON.parse に失敗した場合は生値をそのまま使う
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function setClientKeyToStorage(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CLIENT_KEY_CONFIG.storageKey, JSON.stringify(key));
}

export function clearClientKeyStorage(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CLIENT_KEY_CONFIG.storageKey);
}
