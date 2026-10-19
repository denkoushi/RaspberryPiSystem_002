import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupErrorText } from './setupError';
import { clearSetupPin, readSetupPin, rememberSetupPin } from './setupPinSession';

describe('setup API errors', () => {
  afterEach(() => { clearSetupPin(); vi.useRealTimers(); });
  it('uses errorCode before code, and uses the API message when supplied', () => {
    expect(setupErrorText({ response: { data: { errorCode: 'NEW_CODE', code: 'OLD_CODE' } } })).toBe('NEW_CODE');
    expect(setupErrorText({ response: { data: { code: 'OLD_CODE' } } })).toBe('OLD_CODE');
    expect(setupErrorText({ response: { data: { errorCode: 'CONFLICT', message: '使用中です' } } })).toBe('使用中です');
  });
  it.each([401, 403])('formats unscoped %s without clearing the setup PIN', (status) => {
    rememberSetupPin('2520');
    setupErrorText({ response: { status, data: { message: '認証が必要です' } } });
    expect(readSetupPin()).toBe('2520');
  });
  it('removes the PIN while the page is absent at exactly five minutes', () => {
    vi.useFakeTimers();
    rememberSetupPin('2520');
    vi.advanceTimersByTime(299_999);
    expect(readSetupPin()).toBe('2520');
    vi.advanceTimersByTime(1);
    expect(readSetupPin()).toBeNull();
  });
});
