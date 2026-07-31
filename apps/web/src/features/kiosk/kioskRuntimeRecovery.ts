import { isFullReleaseSha } from './kioskReleaseIdentity';

const CACHE_BUST_PARAMETER = '__raspi_web_runtime_recovery';
const DYNAMIC_IMPORT_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /expected a javascript module script[^\n]*mime type[^\n]*text\/html/i,
  /loading chunk [\w-]+ failed/i
];

export const KIOSK_RUNTIME_RECOVERY_STORAGE_KEY = 'raspi:web-runtime-recovery:v1';
export const KIOSK_RUNTIME_RECOVERY_WINDOW_MS = 60_000;

interface RecoveryAttemptRecord {
  version: 1;
  pathname: string;
  releaseSha: string;
  attemptedAtMs: number;
}

interface RecoveryInput {
  error: unknown;
  pathname: string;
  currentHref: string;
  currentOrigin: string;
  releaseSha?: string;
  storedValue: string | null;
  nowMs?: number;
}

export type KioskRuntimeRecoveryStopReason =
  | 'unrecognized-error'
  | 'not-kiosk'
  | 'release'
  | 'time'
  | 'storage'
  | 'url'
  | 'attempt-limit';

export type KioskRuntimeRecoveryDecision =
  | { kind: 'reload'; href: string; storedValue: string }
  | { kind: 'stop'; reason: KioskRuntimeRecoveryStopReason };

function errorNameAndMessage(error: unknown): { name: string; message: string } {
  if (typeof error === 'string') return { name: '', message: error };
  if (!error || typeof error !== 'object') return { name: '', message: '' };

  try {
    const candidate = error as { name?: unknown; message?: unknown };
    return {
      name: typeof candidate.name === 'string' ? candidate.name : '',
      message: typeof candidate.message === 'string' ? candidate.message : ''
    };
  } catch {
    return { name: '', message: '' };
  }
}

export function isKnownDynamicImportFailure(error: unknown): boolean {
  const { name, message } = errorNameAndMessage(error);
  if (name === 'ChunkLoadError') return true;
  return DYNAMIC_IMPORT_PATTERNS.some((pattern) => pattern.test(message));
}

function isKioskPath(pathname: string): boolean {
  return pathname === '/kiosk' || pathname.startsWith('/kiosk/');
}

function exactRecord(value: unknown): value is RecoveryAttemptRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 4
    && record.version === 1
    && typeof record.pathname === 'string'
    && isKioskPath(record.pathname)
    && isFullReleaseSha(record.releaseSha)
    && Number.isSafeInteger(record.attemptedAtMs)
    && (record.attemptedAtMs as number) >= 0
  );
}

function parseStoredRecord(storedValue: string | null): RecoveryAttemptRecord | null | 'corrupt' {
  if (storedValue === null) return null;
  try {
    const value: unknown = JSON.parse(storedValue);
    return exactRecord(value) ? value : 'corrupt';
  } catch {
    return 'corrupt';
  }
}

function recoveryHref(
  currentHref: string,
  currentOrigin: string,
  pathname: string,
  releaseSha: string,
  nowMs: number
): string | null {
  try {
    const url = new URL(currentHref);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.origin !== currentOrigin
      || url.pathname !== pathname
    ) {
      return null;
    }
    url.searchParams.set(
      CACHE_BUST_PARAMETER,
      `${releaseSha.slice(0, 12)}.${nowMs}`
    );
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Decide whether one render failure may trigger a bounded kiosk reload.
 *
 * This function is deterministic and performs no storage or navigation I/O.
 * The caller must persist `storedValue` before following a reload decision.
 */
export function decideKioskRuntimeRecovery(
  input: RecoveryInput
): KioskRuntimeRecoveryDecision {
  if (!isKnownDynamicImportFailure(input.error)) {
    return { kind: 'stop', reason: 'unrecognized-error' };
  }
  if (!isKioskPath(input.pathname)) {
    return { kind: 'stop', reason: 'not-kiosk' };
  }
  if (!isFullReleaseSha(input.releaseSha)) {
    return { kind: 'stop', reason: 'release' };
  }

  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { kind: 'stop', reason: 'time' };
  }

  const stored = parseStoredRecord(input.storedValue);
  if (stored === 'corrupt') {
    return { kind: 'stop', reason: 'storage' };
  }
  if (stored && stored.pathname === input.pathname && stored.releaseSha === input.releaseSha) {
    const elapsedMs = nowMs - stored.attemptedAtMs;
    if (elapsedMs < 0) return { kind: 'stop', reason: 'time' };
    if (elapsedMs < KIOSK_RUNTIME_RECOVERY_WINDOW_MS) {
      return { kind: 'stop', reason: 'attempt-limit' };
    }
  }

  const href = recoveryHref(
    input.currentHref,
    input.currentOrigin,
    input.pathname,
    input.releaseSha,
    nowMs
  );
  if (href === null) return { kind: 'stop', reason: 'url' };

  const record: RecoveryAttemptRecord = {
    version: 1,
    pathname: input.pathname,
    releaseSha: input.releaseSha,
    attemptedAtMs: nowMs
  };
  return { kind: 'reload', href, storedValue: JSON.stringify(record) };
}
