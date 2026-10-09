export const KIOSK_WEB_UPDATE_STORAGE_KEY = 'raspi:kiosk-idle-web-update:v1';
export const KIOSK_WEB_UPDATE_POLL_MS = 180_000;
export const KIOSK_WEB_UPDATE_IDLE_MS = 600_000;
export const KIOSK_WEB_UPDATE_RETRY_INTERVAL_MS = 300_000;
export const KIOSK_WEB_UPDATE_MAX_ATTEMPTS = 2;

export function isKioskPath(pathname: string): boolean {
  return pathname === '/kiosk' || pathname.startsWith('/kiosk/');
}

export function hasKioskEntryChanged(currentEntry: string | null, serverEntry: string | null): boolean {
  return Boolean(currentEntry && serverEntry && currentEntry !== serverEntry);
}

interface UpdateAttempt {
  entry: string;
  count: number;
  lastAttemptAtMs: number;
}

function readAttempts(storedValue: string | null): UpdateAttempt[] | null {
  if (storedValue === null) return [];
  try {
    const value = JSON.parse(storedValue) as { version?: unknown; attempts?: unknown } | null;
    if (value?.version !== 1 || !Array.isArray(value.attempts)) return null;
    const entries = new Set<string>();
    for (const attempt of value.attempts as UpdateAttempt[]) {
      if (!attempt || typeof attempt.entry !== 'string' || !attempt.entry || entries.has(attempt.entry)
        || !Number.isSafeInteger(attempt.count) || attempt.count < 1 || attempt.count > KIOSK_WEB_UPDATE_MAX_ATTEMPTS
        || !Number.isSafeInteger(attempt.lastAttemptAtMs) || attempt.lastAttemptAtMs < 0) return null;
      entries.add(attempt.entry);
    }
    return value.attempts as UpdateAttempt[];
  } catch {
    return null;
  }
}

export interface KioskWebUpdateInput {
  pathname: string;
  currentEntry: string | null;
  serverEntry: string | null;
  nowMs: number;
  lastInputAtMs: number;
  hasInputFocus: boolean;
  hasDialog: boolean;
  hasChatPanel: boolean;
  isOnline: boolean;
  isMaintenance: boolean;
  storedValue: string | null;
}

/** No browser, storage, clock, or navigation I/O. Persist before navigating. */
export function decideKioskWebUpdate(input: KioskWebUpdateInput):
  | { kind: 'none' }
  | { kind: 'reload'; storedValue: string } {
  if (!isKioskPath(input.pathname) || !hasKioskEntryChanged(input.currentEntry, input.serverEntry)
    || !input.isOnline || input.isMaintenance || input.hasInputFocus || input.hasDialog || input.hasChatPanel
    || !Number.isSafeInteger(input.nowMs) || !Number.isSafeInteger(input.lastInputAtMs)
    || input.lastInputAtMs < 0 || input.nowMs - input.lastInputAtMs < KIOSK_WEB_UPDATE_IDLE_MS) {
    return { kind: 'none' };
  }
  const attempts = readAttempts(input.storedValue);
  if (attempts === null) return { kind: 'none' };
  const previous = attempts.find((attempt) => attempt.entry === input.serverEntry);
  if (previous && (previous.count >= KIOSK_WEB_UPDATE_MAX_ATTEMPTS
    || input.nowMs - previous.lastAttemptAtMs < KIOSK_WEB_UPDATE_RETRY_INTERVAL_MS)) return { kind: 'none' };
  const next: UpdateAttempt = {
    entry: input.serverEntry!,
    count: (previous?.count ?? 0) + 1,
    lastAttemptAtMs: input.nowMs
  };
  return {
    kind: 'reload',
    storedValue: JSON.stringify({ version: 1, attempts: [...attempts.filter((attempt) => attempt !== previous), next] })
  };
}
