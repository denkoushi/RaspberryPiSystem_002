import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  browserKioskRuntimeRecovery
} from './browserKioskRuntimeRecovery';
import { KIOSK_RUNTIME_RECOVERY_STORAGE_KEY } from './kioskRuntimeRecovery';

const RELEASE_SHA = 'd'.repeat(40);
const MODULE_ERROR = new TypeError(
  'Failed to fetch dynamically imported module: http://localhost/assets/page-old.js'
);

describe('browserKioskRuntimeRecovery', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/kiosk/assembly/templates/new?source=test#editor');
    window.sessionStorage.clear();
    vi.stubEnv('VITE_RELEASE_SHA', RELEASE_SHA);
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('persists the bounded attempt before returning a reload URL', () => {
    const decision = browserKioskRuntimeRecovery.decide(MODULE_ERROR);

    expect(decision.kind).toBe('reload');
    expect(window.sessionStorage.getItem(KIOSK_RUNTIME_RECOVERY_STORAGE_KEY)).not.toBeNull();
    if (decision.kind !== 'reload') return;
    const url = new URL(decision.href);
    expect(url.pathname).toBe('/kiosk/assembly/templates/new');
    expect(url.searchParams.get('source')).toBe('test');
    expect(url.hash).toBe('#editor');
  });

  it('fails closed when session storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(browserKioskRuntimeRecovery.decide(MODULE_ERROR)).toEqual({ kind: 'stop' });
  });

  it('fails closed when the attempt cannot be persisted', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(browserKioskRuntimeRecovery.decide(MODULE_ERROR)).toEqual({ kind: 'stop' });
  });
});
