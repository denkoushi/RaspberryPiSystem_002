import { describe, expect, it } from 'vitest';

import {
  advanceKioskWebActivation,
  KIOSK_WEB_ACTIVATION_DEADLINE_MS,
  KIOSK_WEB_ACTIVATION_MAX_ATTEMPTS,
  KIOSK_WEB_ACTIVATION_RETRY_INTERVAL_MS
} from './kioskWebActivation';

const OLD_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);
const RUN_ID = 'run-web-activation';
const VERIFICATION_ID = '1'.repeat(32);

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function status(verificationId = VERIFICATION_ID) {
  return {
    isMaintenance: true,
    phase: 'verifying',
    desiredReleaseSha: NEW_SHA,
    verificationId
  };
}

function advance(
  storage: MemoryStorage,
  compiledReleaseSha: string,
  nowMs: number,
  verificationId = VERIFICATION_ID
) {
  return advanceKioskWebActivation({
    status: status(verificationId),
    runId: RUN_ID,
    compiledReleaseSha,
    currentHref: 'https://kiosk.example.invalid/kiosk/borrow?mode=active#panel',
    storage,
    nowMs
  });
}

describe('bounded Kiosk Web activation', () => {
  it('crosses a reload boundary and treats only the new compiled bundle as current', () => {
    const storage = new MemoryStorage();
    const staleDocument = advance(storage, OLD_SHA, 1_000);

    expect(staleDocument.kind).toBe('reload');
    if (staleDocument.kind !== 'reload') throw new Error('expected reload');
    const url = new URL(staleDocument.href);
    expect(url.origin).toBe('https://kiosk.example.invalid');
    expect(url.pathname).toBe('/kiosk/borrow');
    expect(url.searchParams.get('mode')).toBe('active');
    expect(url.searchParams.get('__raspi_kiosk_web_release')).toBe(
      `${RUN_ID}.${VERIFICATION_ID}.${NEW_SHA}.1`
    );

    // A separate document receives the same session storage after navigation.
    const currentDocument = advance(storage, NEW_SHA, 1_100);
    expect(currentDocument).toEqual({ kind: 'current' });
    expect(storage.values.size).toBe(0);
  });

  it('bounds repeated cache-stale reloads by interval and attempt count', () => {
    const storage = new MemoryStorage();
    expect(advance(storage, OLD_SHA, 1_000)).toMatchObject({ kind: 'reload', attempt: 1 });
    expect(advance(storage, OLD_SHA, 1_100)).toEqual({
      kind: 'wait',
      retryAfterMs: KIOSK_WEB_ACTIVATION_RETRY_INTERVAL_MS - 100
    });
    expect(advance(storage, OLD_SHA, 3_000)).toMatchObject({ kind: 'reload', attempt: 2 });
    expect(advance(storage, OLD_SHA, 5_000)).toMatchObject({ kind: 'reload', attempt: 3 });
    expect(advance(storage, OLD_SHA, 7_000)).toEqual({
      kind: 'exhausted',
      reason: 'attempt-limit'
    });
    expect(KIOSK_WEB_ACTIVATION_MAX_ATTEMPTS).toBe(3);
  });

  it('stops at the elapsed-time deadline even with attempts remaining', () => {
    const storage = new MemoryStorage();
    expect(advance(storage, OLD_SHA, 10_000)).toMatchObject({ kind: 'reload' });
    expect(advance(storage, OLD_SHA, 10_000 + KIOSK_WEB_ACTIVATION_DEADLINE_MS)).toEqual({
      kind: 'exhausted',
      reason: 'deadline'
    });
  });

  it('rejects malformed challenges and compiled identities without navigating', () => {
    const storage = new MemoryStorage();
    const malformed = advanceKioskWebActivation({
      status: { ...status(), verificationId: 'invalid' },
      runId: RUN_ID,
      compiledReleaseSha: OLD_SHA,
      currentHref: 'https://kiosk.example.invalid/kiosk',
      storage,
      nowMs: 1_000
    });
    expect(malformed).toEqual({ kind: 'none' });
    expect(advance(storage, 'not-a-sha', 1_000)).toEqual({ kind: 'none' });
    expect(storage.values.size).toBe(0);
  });

  it('starts a fresh bounded cycle when the verification ID changes', () => {
    const storage = new MemoryStorage();
    expect(advance(storage, OLD_SHA, 1_000)).toMatchObject({ kind: 'reload', attempt: 1 });
    expect(advance(storage, OLD_SHA, 1_100, '2'.repeat(32))).toMatchObject({
      kind: 'reload',
      attempt: 1
    });
  });

  it('fails closed when retry metadata is corrupt or storage is unavailable', () => {
    const corrupt = new MemoryStorage();
    corrupt.values.set('raspi:kiosk-web-activation:v1', '{broken');
    expect(advance(corrupt, OLD_SHA, 1_000)).toEqual({
      kind: 'exhausted',
      reason: 'storage'
    });
    expect(advance(corrupt, OLD_SHA, 3_000)).toEqual({
      kind: 'exhausted',
      reason: 'attempt-limit'
    });

    const unavailable = {
      getItem(): string | null { throw new Error('unavailable'); },
      setItem(): void { throw new Error('unavailable'); },
      removeItem(): void { throw new Error('unavailable'); }
    };
    expect(advanceKioskWebActivation({
      status: status(),
      runId: RUN_ID,
      compiledReleaseSha: OLD_SHA,
      currentHref: 'https://kiosk.example.invalid/kiosk',
      storage: unavailable,
      nowMs: 1_000
    })).toEqual({ kind: 'exhausted', reason: 'storage' });
  });
});
