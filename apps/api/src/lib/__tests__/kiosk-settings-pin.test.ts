import type { FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireKioskClientDevice: vi.fn(),
  verifyDueManagementAccessPassword: vi.fn()
}));

vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  requireKioskClientDevice: mocks.requireKioskClientDevice
}));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared-location',
  verifyDueManagementAccessPassword: mocks.verifyDueManagementAccessPassword
}));

import { ApiError } from '../errors.js';
import { createKioskSettingsPinGuard, KIOSK_SETTINGS_PASSWORD_HEADER } from '../kiosk-settings-pin.js';

const CORRECT_PIN = '1234';
const OPTIONS = {
  deniedMessage: '操作パスワードが違います',
  deniedCode: 'TEST_PIN_DENIED',
  rateLimitedCode: 'TEST_PIN_RATE_LIMITED'
};

function makeRequest(opts: { clientKey?: string; pin?: string | string[]; ip?: string } = {}): FastifyRequest {
  const headers: Record<string, unknown> = { 'x-client-key': opts.clientKey ?? 'key-a' };
  if (opts.pin !== undefined) headers[KIOSK_SETTINGS_PASSWORD_HEADER] = opts.pin;
  return { headers, ip: opts.ip ?? '10.0.0.1' } as unknown as FastifyRequest;
}

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected ApiError');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
  mocks.requireKioskClientDevice.mockReset();
  mocks.verifyDueManagementAccessPassword.mockReset();
  mocks.requireKioskClientDevice.mockImplementation(async (rawKey: unknown) => {
    if (rawKey === 'key-a' || rawKey === '"key-a"') return { clientDevice: { id: 'device-a' } };
    if (rawKey === 'key-b') return { clientDevice: { id: 'device-b' } };
    throw new ApiError(401, 'クライアント API キーが不正です', undefined, 'INVALID_CLIENT_KEY');
  });
  mocks.verifyDueManagementAccessPassword.mockImplementation(async ({ password }: { password: string }) => ({
    success: password === CORRECT_PIN
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createKioskSettingsPinGuard.authorize', () => {
  it('returns the client device id when key and PIN header are valid', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    await expect(guard.authorize(makeRequest({ pin: CORRECT_PIN }))).resolves.toEqual({ clientDeviceId: 'device-a' });
    expect(mocks.verifyDueManagementAccessPassword).toHaveBeenCalledWith({ location: 'shared-location', password: CORRECT_PIN });
  });

  it('trims whitespace around the PIN and uses the first value of a repeated header', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    await expect(guard.authorize(makeRequest({ pin: ` ${CORRECT_PIN}\t` }))).resolves.toEqual({ clientDeviceId: 'device-a' });
    await expect(guard.authorize(makeRequest({ pin: [CORRECT_PIN, '9999'] }))).resolves.toEqual({ clientDeviceId: 'device-a' });
  });

  it('denies with the configured code/message for a wrong PIN', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    const error = await captureError(guard.authorize(makeRequest({ pin: '9999' })));
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('TEST_PIN_DENIED');
    expect(error.message).toBe(OPTIONS.deniedMessage);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['3 digits', '123'],
    ['5 digits', '12345'],
    ['non-digit', '12a4'],
    ['full-width digits', '１２３４']
  ])('denies a %s PIN without consulting the stored password', async (_label, pin) => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    const error = await captureError(guard.authorize(makeRequest({ pin })));
    expect(error.code).toBe('TEST_PIN_DENIED');
    expect(mocks.verifyDueManagementAccessPassword).not.toHaveBeenCalled();
  });

  it('propagates client-key rejection before checking the PIN', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    const error = await captureError(guard.authorize(makeRequest({ clientKey: 'unknown', pin: CORRECT_PIN })));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('INVALID_CLIENT_KEY');
    expect(mocks.verifyDueManagementAccessPassword).not.toHaveBeenCalled();
  });
});

describe('createKioskSettingsPinGuard rate limiting', () => {
  it('blocks the 11th attempt after 10 failures, even with the correct PIN', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    for (let i = 0; i < 10; i += 1) {
      expect((await captureError(guard.authorize(makeRequest({ pin: '0000' })))).code).toBe('TEST_PIN_DENIED');
    }
    const blocked = await captureError(guard.authorize(makeRequest({ pin: CORRECT_PIN })));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.code).toBe('TEST_PIN_RATE_LIMITED');
    // The stored password is consulted for the 10 failures only, not once blocked.
    expect(mocks.verifyDueManagementAccessPassword).toHaveBeenCalledTimes(10);
  });

  it('allows the 10th attempt (limit boundary) and resets the counter on success', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    for (let i = 0; i < 9; i += 1) await captureError(guard.authorize(makeRequest({ pin: '0000' })));
    await expect(guard.authorize(makeRequest({ pin: CORRECT_PIN }))).resolves.toEqual({ clientDeviceId: 'device-a' });

    // Counter was reset: another 9 failures still leave room for the correct PIN.
    for (let i = 0; i < 9; i += 1) await captureError(guard.authorize(makeRequest({ pin: '0000' })));
    await expect(guard.authorize(makeRequest({ pin: CORRECT_PIN }))).resolves.toEqual({ clientDeviceId: 'device-a' });
  });

  it('unblocks after the 60 second window expires', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    for (let i = 0; i < 10; i += 1) await captureError(guard.authorize(makeRequest({ pin: '0000' })));

    vi.advanceTimersByTime(59_999);
    expect((await captureError(guard.authorize(makeRequest({ pin: CORRECT_PIN })))).statusCode).toBe(429);

    vi.advanceTimersByTime(1);
    await expect(guard.authorize(makeRequest({ pin: CORRECT_PIN }))).resolves.toEqual({ clientDeviceId: 'device-a' });
  });

  it('does not extend the window with further failures inside it', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    await captureError(guard.authorize(makeRequest({ pin: '0000' })));
    vi.advanceTimersByTime(30_000);
    for (let i = 0; i < 9; i += 1) await captureError(guard.authorize(makeRequest({ pin: '0000' })));
    expect((await captureError(guard.authorize(makeRequest({ pin: CORRECT_PIN })))).statusCode).toBe(429);

    vi.advanceTimersByTime(30_000);
    await expect(guard.authorize(makeRequest({ pin: CORRECT_PIN }))).resolves.toEqual({ clientDeviceId: 'device-a' });
  });

  it('counts per terminal and per IP independently', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    for (let i = 0; i < 10; i += 1) await captureError(guard.authorize(makeRequest({ clientKey: 'key-a', pin: '0000' })));

    await expect(guard.authorize(makeRequest({ clientKey: 'key-b', pin: CORRECT_PIN }))).resolves.toEqual({ clientDeviceId: 'device-b' });
    await expect(guard.authorize(makeRequest({ clientKey: 'key-a', ip: '10.0.0.2', pin: CORRECT_PIN }))).resolves.toEqual({
      clientDeviceId: 'device-a'
    });
    expect((await captureError(guard.authorize(makeRequest({ clientKey: 'key-a', pin: CORRECT_PIN })))).statusCode).toBe(429);
  });

  it('shares one counter across different spellings of the same client key', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    for (let i = 0; i < 5; i += 1) await captureError(guard.authorize(makeRequest({ clientKey: 'key-a', pin: '0000' })));
    for (let i = 0; i < 5; i += 1) await captureError(guard.authorize(makeRequest({ clientKey: '"key-a"', pin: '0000' })));
    expect((await captureError(guard.authorize(makeRequest({ clientKey: 'key-a', pin: CORRECT_PIN })))).statusCode).toBe(429);
  });

  it('keeps separate counters per guard instance', async () => {
    const guardA = createKioskSettingsPinGuard(OPTIONS);
    const guardB = createKioskSettingsPinGuard({ ...OPTIONS, rateLimitedCode: 'OTHER' });
    for (let i = 0; i < 10; i += 1) await captureError(guardA.authorize(makeRequest({ pin: '0000' })));
    await expect(guardB.authorize(makeRequest({ pin: CORRECT_PIN }))).resolves.toEqual({ clientDeviceId: 'device-a' });
  });
});

describe('createKioskSettingsPinGuard.verify', () => {
  it('returns success flags instead of throwing for wrong PINs', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    await expect(guard.verify(makeRequest(), CORRECT_PIN)).resolves.toEqual({ success: true });
    await expect(guard.verify(makeRequest(), '9999')).resolves.toEqual({ success: false });
    await expect(guard.verify(makeRequest(), 'abcd')).resolves.toEqual({ success: false });
  });

  it('shares the failure counter with authorize and throws 429 once blocked', async () => {
    const guard = createKioskSettingsPinGuard(OPTIONS);
    for (let i = 0; i < 10; i += 1) await guard.verify(makeRequest(), '0000');
    const error = await captureError(guard.authorize(makeRequest({ pin: CORRECT_PIN })));
    expect(error.statusCode).toBe(429);
    const verifyError = await captureError(guard.verify(makeRequest(), CORRECT_PIN));
    expect(verifyError.code).toBe('TEST_PIN_RATE_LIMITED');
  });
});
