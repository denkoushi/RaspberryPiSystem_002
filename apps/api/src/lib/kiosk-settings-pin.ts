import type { FastifyRequest } from 'fastify';

import { ApiError } from './errors.js';
import { requireKioskClientDevice } from '../services/clients/client-device-auth.service.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword
} from '../services/production-schedule/production-schedule-settings.service.js';

/**
 * Kiosk screens that change master data are opened with the shared 4-digit operation
 * password (the same one as due management and inventory setup). The terminal sends it on
 * every request as `x-kiosk-access-password` next to its `x-client-key`.
 */
export const KIOSK_SETTINGS_PASSWORD_HEADER = 'x-kiosk-access-password';

const FAILED_ATTEMPT_LIMIT = 10;
const FAILED_ATTEMPT_WINDOW_MS = 60_000;

export type KioskSettingsPinOptions = {
  deniedMessage: string;
  deniedCode: string;
  rateLimitedCode: string;
};

export type KioskSettingsPinGuard = {
  /** Resolves the calling terminal after checking its client key and the operation password. */
  authorize: (request: FastifyRequest) => Promise<{ clientDeviceId: string }>;
  /** Checks a password typed on the terminal's PIN pad (used to unlock the screen). */
  verify: (request: FastifyRequest, password: string) => Promise<{ success: boolean }>;
};

function headerValue(request: FastifyRequest, name: string): string {
  const raw = request.headers[name];
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
}

export function createKioskSettingsPinGuard(options: KioskSettingsPinOptions): KioskSettingsPinGuard {
  // Failed tries per terminal; kept in memory like the inventory setup guard.
  const failedAttempts = new Map<string, { count: number; resetAt: number }>();

  // Count by the resolved terminal, so differently spelled headers for the same key share one counter.
  const attemptKey = (request: FastifyRequest, clientDeviceId: string) => `${request.ip}:${clientDeviceId}`;

  const blocked = (request: FastifyRequest, clientDeviceId: string) => {
    const now = Date.now();
    for (const [key, entry] of failedAttempts) {
      if (entry.resetAt <= now) failedAttempts.delete(key);
    }
    return (failedAttempts.get(attemptKey(request, clientDeviceId))?.count ?? 0) >= FAILED_ATTEMPT_LIMIT;
  };

  const recordFailure = (request: FastifyRequest, clientDeviceId: string) => {
    const now = Date.now();
    const key = attemptKey(request, clientDeviceId);
    const current = failedAttempts.get(key);
    if (!current || current.resetAt <= now) {
      failedAttempts.set(key, { count: 1, resetAt: now + FAILED_ATTEMPT_WINDOW_MS });
      return;
    }
    current.count += 1;
  };

  const check = async (request: FastifyRequest, clientDeviceId: string, password: string): Promise<boolean> => {
    if (blocked(request, clientDeviceId)) {
      throw new ApiError(429, '操作パスワードの試行回数が上限に達しました。しばらくしてから再試行してください', undefined, options.rateLimitedCode);
    }
    const trimmed = password.trim();
    const ok = /^\d{4}$/.test(trimmed)
      && (await verifyDueManagementAccessPassword({ location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION, password: trimmed })).success;
    if (ok) failedAttempts.delete(attemptKey(request, clientDeviceId));
    else recordFailure(request, clientDeviceId);
    return ok;
  };

  return {
    async authorize(request) {
      const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
      if (!(await check(request, clientDevice.id, headerValue(request, KIOSK_SETTINGS_PASSWORD_HEADER)))) {
        throw new ApiError(403, options.deniedMessage, undefined, options.deniedCode);
      }
      return { clientDeviceId: clientDevice.id };
    },
    async verify(request, password) {
      const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
      return { success: await check(request, clientDevice.id, password) };
    }
  };
}
