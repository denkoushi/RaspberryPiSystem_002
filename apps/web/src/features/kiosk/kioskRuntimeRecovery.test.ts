import { describe, expect, it } from 'vitest';

import {
  decideKioskRuntimeRecovery,
  isKnownDynamicImportFailure,
  KIOSK_RUNTIME_RECOVERY_WINDOW_MS
} from './kioskRuntimeRecovery';

const RELEASE_SHA = 'a'.repeat(40);
const OTHER_RELEASE_SHA = 'b'.repeat(40);
const NOW_MS = 10_000;
const BASE_INPUT = {
  error: new TypeError('Failed to fetch dynamically imported module: https://kiosk.example/assets/page-old.js'),
  pathname: '/kiosk/part-measurement/inspection',
  currentHref: 'https://kiosk.example/kiosk/part-measurement/inspection?mode=latest#drawing',
  currentOrigin: 'https://kiosk.example',
  releaseSha: RELEASE_SHA,
  storedValue: null,
  nowMs: NOW_MS
};

describe('isKnownDynamicImportFailure', () => {
  it.each([
    new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/page.js'),
    new TypeError('error loading dynamically imported module: https://example.test/assets/page.js'),
    new TypeError('Importing a module script failed.'),
    new TypeError('Expected a JavaScript module script but the server responded with a MIME type of "text/html".'),
    Object.assign(new Error('chunk request failed'), { name: 'ChunkLoadError' }),
    new Error('Loading chunk KioskPage-123 failed')
  ])('recognizes a browser module-load failure', (error) => {
    expect(isKnownDynamicImportFailure(error)).toBe(true);
  });

  it.each([
    new TypeError('Failed to fetch'),
    new Error('render failed'),
    { message: 123 },
    null
  ])('does not classify unrelated failures', (error) => {
    expect(isKnownDynamicImportFailure(error)).toBe(false);
  });
});

describe('decideKioskRuntimeRecovery', () => {
  it('returns one same-origin cache-busted reload while preserving route state', () => {
    const decision = decideKioskRuntimeRecovery(BASE_INPUT);

    expect(decision.kind).toBe('reload');
    if (decision.kind !== 'reload') return;
    const url = new URL(decision.href);
    expect(url.origin).toBe(BASE_INPUT.currentOrigin);
    expect(url.pathname).toBe(BASE_INPUT.pathname);
    expect(url.searchParams.get('mode')).toBe('latest');
    expect(url.searchParams.get('__raspi_web_runtime_recovery')).toBe('aaaaaaaaaaaa.10000');
    expect(url.hash).toBe('#drawing');
    expect(JSON.parse(decision.storedValue)).toEqual({
      version: 1,
      pathname: BASE_INPUT.pathname,
      releaseSha: RELEASE_SHA,
      attemptedAtMs: NOW_MS
    });
  });

  it('stops a second attempt for the same path and release inside the window', () => {
    const first = decideKioskRuntimeRecovery(BASE_INPUT);
    if (first.kind !== 'reload') throw new Error('expected initial reload');

    expect(decideKioskRuntimeRecovery({
      ...BASE_INPUT,
      storedValue: first.storedValue,
      nowMs: NOW_MS + KIOSK_RUNTIME_RECOVERY_WINDOW_MS - 1
    })).toEqual({ kind: 'stop', reason: 'attempt-limit' });
  });

  it('allows a new attempt after the recovery window expires', () => {
    const first = decideKioskRuntimeRecovery(BASE_INPUT);
    if (first.kind !== 'reload') throw new Error('expected initial reload');

    expect(decideKioskRuntimeRecovery({
      ...BASE_INPUT,
      storedValue: first.storedValue,
      nowMs: NOW_MS + KIOSK_RUNTIME_RECOVERY_WINDOW_MS
    }).kind).toBe('reload');
  });

  it('allows a different kiosk path or release to own a new bounded attempt', () => {
    const first = decideKioskRuntimeRecovery(BASE_INPUT);
    if (first.kind !== 'reload') throw new Error('expected initial reload');

    expect(decideKioskRuntimeRecovery({
      ...BASE_INPUT,
      pathname: '/kiosk/assembly/templates/new',
      currentHref: 'https://kiosk.example/kiosk/assembly/templates/new',
      storedValue: first.storedValue
    }).kind).toBe('reload');
    expect(decideKioskRuntimeRecovery({
      ...BASE_INPUT,
      releaseSha: OTHER_RELEASE_SHA,
      storedValue: first.storedValue
    }).kind).toBe('reload');
  });

  it.each([
    [{ error: new Error('render failed') }, 'unrecognized-error'],
    [{ pathname: '/admin', currentHref: 'https://kiosk.example/admin' }, 'not-kiosk'],
    [{ releaseSha: undefined }, 'release'],
    [{ releaseSha: 'not-a-sha' }, 'release'],
    [{ nowMs: -1 }, 'time'],
    [{ storedValue: '{broken' }, 'storage'],
    [{ currentOrigin: 'https://other.example' }, 'url'],
    [{ currentHref: 'file:///kiosk/part-measurement/inspection' }, 'url']
  ] as const)('fails closed for unsafe input with reason %s', (override, reason) => {
    expect(decideKioskRuntimeRecovery({ ...BASE_INPUT, ...override })).toEqual({
      kind: 'stop',
      reason
    });
  });

  it('fails closed when the clock moves backward for the same attempt', () => {
    const storedValue = JSON.stringify({
      version: 1,
      pathname: BASE_INPUT.pathname,
      releaseSha: RELEASE_SHA,
      attemptedAtMs: NOW_MS + 1
    });
    expect(decideKioskRuntimeRecovery({ ...BASE_INPUT, storedValue })).toEqual({
      kind: 'stop',
      reason: 'time'
    });
  });
});
