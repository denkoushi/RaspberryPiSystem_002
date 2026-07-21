import {
  isFullReleaseSha,
  resolveKioskVerificationChallenge
} from './kioskReleaseIdentity';

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;
const STORAGE_KEY = 'raspi:kiosk-web-activation:v1';
const CACHE_BUST_PARAMETER = '__raspi_kiosk_web_release';

export const KIOSK_WEB_ACTIVATION_MAX_ATTEMPTS = 3;
export const KIOSK_WEB_ACTIVATION_DEADLINE_MS = 60_000;
export const KIOSK_WEB_ACTIVATION_RETRY_INTERVAL_MS = 2_000;

interface DeployVerificationIdentity {
  isMaintenance: boolean;
  phase?: string;
  desiredReleaseSha?: string;
  verificationId?: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ActivationAttemptRecord {
  version: 1;
  runId: string;
  verificationId: string;
  desiredReleaseSha: string;
  firstSeenAtMs: number;
  lastAttemptAtMs: number | null;
  attempts: number;
}

export type KioskWebActivationDecision =
  | { kind: 'none' }
  | { kind: 'current' }
  | { kind: 'wait'; retryAfterMs: number }
  | { kind: 'reload'; href: string; attempt: number }
  | { kind: 'exhausted'; reason: 'attempt-limit' | 'deadline' | 'storage' | 'url' };

interface ActivationInput {
  status: DeployVerificationIdentity | undefined;
  runId: string | undefined;
  compiledReleaseSha?: string;
  currentHref: string;
  storage: StorageLike;
  nowMs?: number;
}

function exactRecord(value: unknown): value is ActivationAttemptRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 7
    && record.version === 1
    && typeof record.runId === 'string'
    && RUN_ID_PATTERN.test(record.runId)
    && typeof record.verificationId === 'string'
    && /^[0-9a-f]{32}$/.test(record.verificationId)
    && isFullReleaseSha(record.desiredReleaseSha)
    && Number.isSafeInteger(record.firstSeenAtMs)
    && (record.firstSeenAtMs as number) >= 0
    && (record.lastAttemptAtMs === null
      || (Number.isSafeInteger(record.lastAttemptAtMs) && (record.lastAttemptAtMs as number) >= 0))
    && Number.isSafeInteger(record.attempts)
    && (record.attempts as number) >= 0
    && (record.attempts as number) <= KIOSK_WEB_ACTIVATION_MAX_ATTEMPTS
  );
}

function sameChallenge(
  record: ActivationAttemptRecord,
  runId: string,
  verificationId: string,
  desiredReleaseSha: string
): boolean {
  return record.runId === runId
    && record.verificationId === verificationId
    && record.desiredReleaseSha === desiredReleaseSha;
}

function clearRecord(storage: StorageLike): boolean {
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function persistRecord(storage: StorageLike, record: ActivationAttemptRecord): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function readRecord(storage: StorageLike): ActivationAttemptRecord | null | 'corrupt' {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return 'corrupt';
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return exactRecord(value) ? value : 'corrupt';
  } catch {
    return 'corrupt';
  }
}

function cacheBustedHref(
  currentHref: string,
  record: ActivationAttemptRecord,
  attempt: number
): string | null {
  try {
    const url = new URL(currentHref);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const token = [
      record.runId,
      record.verificationId,
      record.desiredReleaseSha,
      String(attempt)
    ].join('.');
    url.searchParams.set(CACHE_BUST_PARAMETER, token);
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Advance one bounded stale-bundle activation cycle.
 *
 * The desired SHA remains a challenge and cache key. This function never
 * turns it into browser evidence; only resolveKioskReadyChallenge may do that
 * after a newly loaded bundle compares its own compile-time SHA exactly.
 */
export function advanceKioskWebActivation(input: ActivationInput): KioskWebActivationDecision {
  const nowMs = input.nowMs ?? Date.now();
  const challenge = resolveKioskVerificationChallenge(input.status);
  if (
    !challenge
    || typeof input.runId !== 'string'
    || !RUN_ID_PATTERN.test(input.runId)
    || !isFullReleaseSha(input.compiledReleaseSha)
  ) {
    clearRecord(input.storage);
    return { kind: 'none' };
  }
  if (input.compiledReleaseSha === challenge.desiredReleaseSha) {
    return clearRecord(input.storage) ? { kind: 'current' } : {
      kind: 'exhausted',
      reason: 'storage'
    };
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { kind: 'exhausted', reason: 'deadline' };
  }

  const stored = readRecord(input.storage);
  if (stored === 'corrupt') {
    const tombstone: ActivationAttemptRecord = {
      version: 1,
      runId: input.runId,
      verificationId: challenge.verificationId,
      desiredReleaseSha: challenge.desiredReleaseSha,
      firstSeenAtMs: nowMs,
      lastAttemptAtMs: nowMs,
      attempts: KIOSK_WEB_ACTIVATION_MAX_ATTEMPTS
    };
    persistRecord(input.storage, tombstone);
    return { kind: 'exhausted', reason: 'storage' };
  }
  let record = stored;
  if (
    record === null
    || !sameChallenge(
      record,
      input.runId,
      challenge.verificationId,
      challenge.desiredReleaseSha
    )
  ) {
    record = {
      version: 1,
      runId: input.runId,
      verificationId: challenge.verificationId,
      desiredReleaseSha: challenge.desiredReleaseSha,
      firstSeenAtMs: nowMs,
      lastAttemptAtMs: null,
      attempts: 0
    };
  }

  const elapsed = nowMs - record.firstSeenAtMs;
  if (elapsed < 0 || elapsed >= KIOSK_WEB_ACTIVATION_DEADLINE_MS) {
    return { kind: 'exhausted', reason: 'deadline' };
  }
  if (record.attempts >= KIOSK_WEB_ACTIVATION_MAX_ATTEMPTS) {
    return { kind: 'exhausted', reason: 'attempt-limit' };
  }
  if (record.lastAttemptAtMs !== null) {
    const sinceAttempt = nowMs - record.lastAttemptAtMs;
    if (sinceAttempt < 0) return { kind: 'exhausted', reason: 'deadline' };
    if (sinceAttempt < KIOSK_WEB_ACTIVATION_RETRY_INTERVAL_MS) {
      return {
        kind: 'wait',
        retryAfterMs: KIOSK_WEB_ACTIVATION_RETRY_INTERVAL_MS - sinceAttempt
      };
    }
  }

  const attempt = record.attempts + 1;
  const href = cacheBustedHref(input.currentHref, record, attempt);
  if (href === null) return { kind: 'exhausted', reason: 'url' };
  const advanced: ActivationAttemptRecord = {
    ...record,
    attempts: attempt,
    lastAttemptAtMs: nowMs
  };
  if (!persistRecord(input.storage, advanced)) {
    return { kind: 'exhausted', reason: 'storage' };
  }
  return { kind: 'reload', href, attempt };
}

export const kioskWebNavigation = {
  replace(href: string): void {
    window.location.replace(href);
  }
};
