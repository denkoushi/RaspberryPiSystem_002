import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearProcedureEditorAccess, readProcedureEditorAccess, saveProcedureEditorAccess, subscribeProcedureEditorAccess } from './procedureEditorAccess';

beforeEach(() => { clearProcedureEditorAccess(); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); clearProcedureEditorAccess(); vi.useRealTimers(); });
describe('procedureEditorAccess', () => {
  it('stores access only in sessionStorage for exactly eight hours', () => {
    saveProcedureEditorAccess('2520', 1000);
    expect(JSON.parse(sessionStorage.getItem('procedure-editor-access')!)).toEqual({ expiresAt: 28801000, clientKey: expect.any(String) });
    expect(sessionStorage.getItem('procedure-editor-access')).not.toContain('2520');
    expect(localStorage.getItem('procedure-editor-access')).toBeNull();
    expect(readProcedureEditorAccess(28800999)?.pin).toBe('2520');
    expect(readProcedureEditorAccess(28801000)).toBeNull();
    expect(sessionStorage.getItem('procedure-editor-access')).toBeNull();
  });
  it('discards access', () => {
    saveProcedureEditorAccess('2520'); clearProcedureEditorAccess(); expect(readProcedureEditorAccess()).toBeNull();
  });
  it.each(['bad', '{}', '{"expiresAt":"bad"}', '{"expiresAt":99999999999999,"clientKey":"x"}'])('ignores storage without an in-memory PIN or with invalid data %s', value => {
    sessionStorage.setItem('procedure-editor-access', value); expect(readProcedureEditorAccess()).toBeNull();
  });
  it.each(['a', '123456', 'x'.repeat(128)])('accepts one through 128 characters (%s)', pin => {
    saveProcedureEditorAccess(pin); expect(readProcedureEditorAccess()?.pin).toBe(pin);
  });
  it.each(['', 'x'.repeat(129)])('rejects invalid length (%s)', pin => {
    saveProcedureEditorAccess(pin); expect(readProcedureEditorAccess()).toBeNull();
  });
  it('keeps session access when only storage writes are refused', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    saveProcedureEditorAccess('2520', 1000); expect(readProcedureEditorAccess(2000)?.pin).toBe('2520');
  });
  it('works in memory when storage is inaccessible and still expires and clears', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('blocked'); });
    expect(readProcedureEditorAccess()).toBeNull(); saveProcedureEditorAccess('2520', 1000);
    expect(readProcedureEditorAccess(2000)?.pin).toBe('2520'); clearProcedureEditorAccess(); expect(readProcedureEditorAccess(2000)).toBeNull();
    saveProcedureEditorAccess('2520', 1000); expect(readProcedureEditorAccess(28801000)).toBeNull();
  });
  it('removes access at its deadline without a read and cancels the old timer on renewal', () => {
    vi.useFakeTimers();
    saveProcedureEditorAccess('2520'); vi.advanceTimersByTime(1000); saveProcedureEditorAccess('123456');
    vi.advanceTimersByTime(8 * 3600000 - 1000);
    expect(sessionStorage.getItem('procedure-editor-access')).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(sessionStorage.getItem('procedure-editor-access')).toBeNull();
  });
  it('discards expired access on visibility restoration even when the timer was suspended', () => {
    vi.useFakeTimers(); saveProcedureEditorAccess('2520');
    vi.setSystemTime(Date.now() + 8 * 3600000);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sessionStorage.getItem('procedure-editor-access')).toBeNull();
  });
  it.each(['read', 'storage', 'visible'])('discards access after the kiosk client key changes (%s)', trigger => {
    localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-first'));
    saveProcedureEditorAccess('2520');
    const changed = vi.fn(); const unsubscribe = subscribeProcedureEditorAccess(changed);
    localStorage.setItem('kiosk-client-key', JSON.stringify('client-key-second'));
    if (trigger === 'read') expect(readProcedureEditorAccess()).toBeNull();
    if (trigger === 'storage') window.dispatchEvent(new StorageEvent('storage', { key: 'kiosk-client-key', storageArea: localStorage }));
    if (trigger === 'visible') { vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')); }
    expect(sessionStorage.getItem('procedure-editor-access')).toBeNull(); expect(changed).toHaveBeenCalled();
    unsubscribe();
  });
});
