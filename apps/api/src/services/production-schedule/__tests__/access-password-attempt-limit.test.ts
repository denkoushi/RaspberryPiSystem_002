import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { configureTestDueManagementAccessPassword } from '../../../test/due-management-access-password.js';
import {
  ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT,
  ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS,
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION as location,
  verifyDueManagementAccessPassword
} from '../production-schedule-settings.service.js';

const verify = (password: string) => verifyDueManagementAccessPassword({ location, password });
const config = () => prisma.productionScheduleAccessPasswordConfig.findUniqueOrThrow({ where: { location } });
const rateLimited = { statusCode: 429, code: 'ACCESS_PASSWORD_RATE_LIMITED' };

describe('shared operation password attempt limit', () => {
  beforeEach(async () => {
    await configureTestDueManagementAccessPassword();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await configureTestDueManagementAccessPassword();
  });

  it('limits attempts before comparing a password once the shared count reaches the limit', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const startedAt = Date.now();
    for (let index = 0; index < ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT; index += 1) {
      expect(await verify('0000')).toEqual({ success: false });
    }
    const saved = await config();
    expect(saved.failedAttemptCount).toBe(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    expect(saved.failedAttemptWindowEndsAt!.getTime()).toBeGreaterThanOrEqual(startedAt + ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS);
    expect(saved.failedAttemptWindowEndsAt!.getTime()).toBeLessThanOrEqual(Date.now() + ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS);
    await expect(verify('2520')).rejects.toMatchObject(rateLimited);
    await expect(verify('0000')).rejects.toMatchObject(rateLimited);
    expect(compare).toHaveBeenCalledTimes(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    expect((await config()).failedAttemptWindowEndsAt).toEqual(saved.failedAttemptWindowEndsAt);
  });

  it('does not count successful comparisons and keeps earlier failures until the window ends', async () => {
    await verify('0000');
    await verify('0000');
    expect(await verify('2520')).toEqual({ success: true });
    expect(await verify('2520')).toEqual({ success: true });
    expect((await config()).failedAttemptCount).toBe(2);
    for (let index = 2; index < ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT; index += 1) {
      expect(await verify('0000')).toEqual({ success: false });
    }
    await expect(verify('2520')).rejects.toMatchObject(rateLimited);
  });

  it('starts a new window at count one after the previous window expires', async () => {
    await prisma.productionScheduleAccessPasswordConfig.update({
      where: { location },
      data: { failedAttemptCount: ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT, failedAttemptWindowEndsAt: new Date(Date.now() - 1000) }
    });
    expect(await verify('0000')).toEqual({ success: false });
    expect(await config()).toMatchObject({ failedAttemptCount: 1 });
    expect((await config()).failedAttemptWindowEndsAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await verify('2520')).toEqual({ success: true });
  });

  it('keeps empty passwords and missing configurations outside the attempt count', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    expect(await verify('  ')).toEqual({ success: false });
    expect(await verifyDueManagementAccessPassword({ location: 'attempt-limit-no-config', password: '0000' })).toEqual({ success: false });
    expect((await config()).failedAttemptCount).toBe(0);
    expect(compare).not.toHaveBeenCalled();
  });

  it('returns a successful attempt only to the window it was counted in', async () => {
    const replacedWindowEndsAt = new Date(Date.now() + ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS * 2);
    const realCompare = bcrypt.compare.bind(bcrypt) as (data: string, encrypted: string) => Promise<boolean>;
    vi.spyOn(bcrypt, 'compare').mockImplementation(async (data: string, encrypted: string) => {
      await prisma.productionScheduleAccessPasswordConfig.update({
        where: { location },
        data: { failedAttemptCount: 3, failedAttemptWindowEndsAt: replacedWindowEndsAt }
      });
      return realCompare(data, encrypted);
    });
    expect(await verify('2520')).toEqual({ success: true });
    expect(await config()).toMatchObject({ failedAttemptCount: 3, failedAttemptWindowEndsAt: replacedWindowEndsAt });
  });

  it('records every concurrent failed comparison atomically and then limits further attempts', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => verify('0000')));
    const completed = results.filter((result) => result.status === 'fulfilled');
    expect(completed).toHaveLength(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(15 - ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    for (const result of results) {
      if (result.status === 'fulfilled') expect(result.value).toEqual({ success: false });
      else expect(result.reason).toMatchObject(rateLimited);
    }
    expect(compare).toHaveBeenCalledTimes(completed.length);
    expect((await config()).failedAttemptCount).toBe(completed.length);
    await expect(verify('2520')).rejects.toMatchObject(rateLimited);
    expect(compare).toHaveBeenCalledTimes(completed.length);
  });
});
