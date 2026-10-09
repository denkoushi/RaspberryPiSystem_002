import { describe, expect, it } from 'vitest';

import {
  decideKioskWebUpdate,
  hasKioskEntryChanged,
  KIOSK_WEB_UPDATE_IDLE_MS,
  KIOSK_WEB_UPDATE_MAX_ATTEMPTS,
  KIOSK_WEB_UPDATE_RETRY_INTERVAL_MS
} from './kioskSeamlessUpdate';

import type { KioskWebUpdateInput } from './kioskSeamlessUpdate';

const input: KioskWebUpdateInput = {
  pathname: '/kiosk/tag',
  currentEntry: '/assets/app-old.js',
  serverEntry: '/assets/app-new.js',
  nowMs: 1_000_000,
  lastInputAtMs: 1_000_000 - KIOSK_WEB_UPDATE_IDLE_MS,
  hasInputFocus: false,
  hasDialog: false,
  hasChatPanel: false,
  isOnline: true,
  isMaintenance: false,
  storedValue: null
};

describe('kiosk idle Web update policy', () => {
  it.each([
    [null, '/assets/app-new.js', false],
    ['/assets/app-old.js', null, false],
    ['/assets/app-old.js', '', false],
    ['/assets/app-old.js', '/assets/app-old.js', false],
    ['/assets/app-old.js', '/assets/app-new.js', true]
  ])('compares known entries (%s, %s)', (current, server, expected) => {
    expect(hasKioskEntryChanged(current as string | null, server as string | null)).toBe(expected);
  });

  it('allows switching exactly at the idle threshold, including /kiosk itself', () => {
    expect(decideKioskWebUpdate(input).kind).toBe('reload');
    expect(decideKioskWebUpdate({ ...input, pathname: '/kiosk' }).kind).toBe('reload');
  });

  it.each<Partial<KioskWebUpdateInput>>([
    { pathname: '/admin' }, { pathname: '/kiosks' },
    { serverEntry: null }, { currentEntry: null }, { serverEntry: input.currentEntry },
    { lastInputAtMs: input.lastInputAtMs + 1 },
    { hasInputFocus: true }, { hasDialog: true }, { hasChatPanel: true },
    { isOnline: false }, { isMaintenance: true },
    { lastInputAtMs: input.nowMs + 1 }, { nowMs: NaN }, { lastInputAtMs: -1 },
    { storedValue: '{broken' }, { storedValue: '{}' },
    { storedValue: JSON.stringify({ version: 1, attempts: [{ entry: 'a', count: 0, lastAttemptAtMs: 1 }] }) }
  ])('does not switch when unsafe: %j', (changes) => {
    expect(decideKioskWebUpdate({ ...input, ...changes })).toEqual({ kind: 'none' });
  });

  it('limits the same server entry by interval and lifetime count across paths', () => {
    const first = decideKioskWebUpdate(input);
    if (first.kind !== 'reload') throw new Error('expected reload');
    const again = { ...input, storedValue: first.storedValue, pathname: '/kiosk/photo' };
    expect(decideKioskWebUpdate({ ...again, nowMs: input.nowMs + KIOSK_WEB_UPDATE_RETRY_INTERVAL_MS - 1 }).kind).toBe('none');
    expect(decideKioskWebUpdate({ ...again, nowMs: input.nowMs - 1 }).kind).toBe('none');
    const second = decideKioskWebUpdate({ ...again, nowMs: input.nowMs + KIOSK_WEB_UPDATE_RETRY_INTERVAL_MS });
    if (second.kind !== 'reload') throw new Error('expected second reload');
    expect(KIOSK_WEB_UPDATE_MAX_ATTEMPTS).toBe(2);
    expect(decideKioskWebUpdate({ ...input, storedValue: second.storedValue, nowMs: input.nowMs + 10_000_000 }).kind).toBe('none');
    const other = decideKioskWebUpdate({ ...input, storedValue: second.storedValue, serverEntry: '/assets/app-other.js' });
    if (other.kind !== 'reload') throw new Error('expected other entry');
    // A rollback must not reset the exhausted budget of a previously seen entry.
    expect(decideKioskWebUpdate({ ...input, storedValue: other.storedValue, nowMs: input.nowMs + 20_000_000 }).kind).toBe('none');
  });
});
