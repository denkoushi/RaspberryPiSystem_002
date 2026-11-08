import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { configureTestDueManagementAccessPassword } from '../../../test/due-management-access-password.js';
import {
  ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT,
  ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT,
  ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS,
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION as location,
  verifyDueManagementAccessPassword
} from '../production-schedule-settings.service.js';

const verify = (password: string, clientDeviceId = 'device-a') => verifyDueManagementAccessPassword({ location, password, clientDeviceId, ip: '192.0.2.1' });
const attempt = (scope = 'device:device-a') => prisma.productionScheduleAccessPasswordAttempt.findUniqueOrThrow({ where: { location_scope: { location, scope } } });
const rateLimited = { statusCode: 429, code: 'ACCESS_PASSWORD_RATE_LIMITED' };
const alertType = 'operation-password-global-limit';

async function fillGlobalLimit() {
  for (let index = 0; index < ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT; index += 1) {
    await verify('0000', `device-${Math.floor(index / ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT)}`);
  }
}

describe('operation password two tier attempt limit', () => {
  beforeEach(async () => {
    await configureTestDueManagementAccessPassword();
    await prisma.alert.deleteMany({ where: { type: alertType } });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await configureTestDueManagementAccessPassword();
    await prisma.alert.deleteMany({ where: { type: alertType } });
  });

  it('limits one device while allowing another device with the correct password', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const startedAt = Date.now();
    for (let index = 0; index < ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT; index += 1) {
      expect(await verify('0000')).toEqual({ success: false });
    }
    const saved = await attempt();
    expect(saved.count).toBe(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    expect(saved.windowEndsAt.getTime()).toBeGreaterThanOrEqual(startedAt + ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS);
    expect(saved.windowEndsAt.getTime()).toBeLessThanOrEqual(Date.now() + ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS);
    await expect(verify('2520')).rejects.toMatchObject(rateLimited);
    expect(compare).toHaveBeenCalledTimes(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    expect(await verify('2520', 'device-b')).toEqual({ success: true });
    expect((await attempt('global')).count).toBe(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    expect((await attempt('device:device-b')).count).toBe(0);
    expect((await attempt()).windowEndsAt).toEqual(saved.windowEndsAt);
  });

  it('returns successful reservations from both counters and retains earlier failures', async () => {
    await verify('0000');
    await verify('0000');
    expect(await verify('2520')).toEqual({ success: true });
    expect(await verify('2520')).toEqual({ success: true });
    expect((await attempt()).count).toBe(2);
    expect((await attempt('global')).count).toBe(2);
  });

  it('starts new windows after both previous windows expire and can notify again', async () => {
    await fillGlobalLimit();
    await prisma.productionScheduleAccessPasswordAttempt.updateMany({ where: { location }, data: { windowEndsAt: new Date(Date.now() - 1000) } });
    expect(await verify('0000', 'device-0')).toEqual({ success: false });
    expect((await attempt('device:device-0')).count).toBe(1);
    expect((await attempt('global')).count).toBe(1);
    expect((await attempt('global')).windowEndsAt.getTime()).toBeGreaterThan(Date.now());
    for (let index = 1; index < ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT; index += 1) {
      await verify('0000', `device-${Math.floor(index / ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT)}`);
    }
    expect(await prisma.alert.count({ where: { type: alertType } })).toBe(2);
  });

  it('keeps empty passwords and missing configurations outside the count', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    expect(await verify('  ')).toEqual({ success: false });
    expect(await verifyDueManagementAccessPassword({ location: 'attempt-limit-no-config', password: '0000', ip: '192.0.2.1' })).toEqual({ success: false });
    expect(await prisma.productionScheduleAccessPasswordAttempt.count({ where: { location } })).toBe(0);
    expect(compare).not.toHaveBeenCalled();
  });

  it('returns reservations only to their original windows', async () => {
    const windowEndsAt = new Date(Date.now() + ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS * 2);
    vi.spyOn(bcrypt, 'compare').mockImplementation(async () => {
      await prisma.productionScheduleAccessPasswordAttempt.updateMany({ where: { location }, data: { count: 3, windowEndsAt } });
      return true;
    });
    expect(await verify('2520')).toEqual({ success: true });
    expect(await attempt()).toMatchObject({ count: 3, windowEndsAt });
    expect(await attempt('global')).toMatchObject({ count: 3, windowEndsAt });
  });

  it('reserves concurrent device attempts atomically without consuming global capacity for rejected attempts', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => verify('0000')));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    for (const result of results) {
      if (result.status === 'fulfilled') expect(result.value).toEqual({ success: false });
      else expect(result.reason).toMatchObject(rateLimited);
    }
    expect(compare).toHaveBeenCalledTimes(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    expect((await attempt()).count).toBe(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
    expect((await attempt('global')).count).toBe(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
  });

  it('limits all devices at the global limit and creates one delivery without caller details', async () => {
    await fillGlobalLimit();
    await expect(verify('2520', 'device-new')).rejects.toMatchObject(rateLimited);
    await expect(verify('0000', 'device-0')).rejects.toMatchObject(rateLimited);
    const alerts = await prisma.alert.findMany({ where: { type: alertType }, include: { deliveries: true } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].deliveries).toHaveLength(1);
    expect(alerts[0].deliveries[0]).toMatchObject({ status: 'PENDING' });
    expect(alerts[0].message).toBe('操作パスワードの全体試行回数が上限に達しました');
    expect(alerts[0].details).toBeNull();
    expect((await attempt('global')).count).toBe(ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT);
  });

  it('reserves the global limit atomically across concurrent devices and notifies once', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const results = await Promise.allSettled(Array.from({ length: 60 }, (_, index) => verify('0000', `concurrent-${index}`)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject(rateLimited);
    }
    expect(compare).toHaveBeenCalledTimes(ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT);
    expect((await attempt('global')).count).toBe(ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT);
    expect(await prisma.alert.count({ where: { type: alertType } })).toBe(1);
  });

  it('falls back to separate IP counters when there is no device', async () => {
    const fromIp = (ip: string, password: string) => verifyDueManagementAccessPassword({ location, password, ip });
    for (let index = 0; index < ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT; index += 1) await fromIp('192.0.2.1', '0000');
    await expect(fromIp('192.0.2.1', '2520')).rejects.toMatchObject(rateLimited);
    expect(await fromIp('192.0.2.2', '2520')).toEqual({ success: true });
  });

  it('uses device identity across changing IPs', async () => {
    for (let index = 0; index < ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT; index += 1) await verify('0000');
    await expect(verifyDueManagementAccessPassword({ location, password: '2520', clientDeviceId: 'device-a', ip: '192.0.2.2' })).rejects.toMatchObject(rateLimited);
  });

  it('preserves the comparison result when notification creation fails and allows a later retry', async () => {
    vi.spyOn(prisma.alert, 'create').mockRejectedValue(new Error('notification unavailable'));
    await fillGlobalLimit();
    await expect(verify('2520', 'another-device')).rejects.toMatchObject(rateLimited);
    expect(prisma.alert.create).toHaveBeenCalledTimes(1);
    expect((await attempt('global')).notified).toBe(false);
  });

  it('does not notify when the attempt that reaches the global limit uses the correct password', async () => {
    for (let index = 0; index < ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT - 1; index += 1) {
      await verify('0000', `device-${Math.floor(index / ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT)}`);
    }
    expect(await verify('2520', 'device-correct')).toEqual({ success: true });
    expect(await prisma.alert.count({ where: { type: alertType } })).toBe(0);
    expect(await attempt('global')).toMatchObject({ count: ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT - 1, notified: false });
    expect(await verify('0000', 'device-last')).toEqual({ success: false });
    expect(await prisma.alert.count({ where: { type: alertType } })).toBe(1);
    expect(await attempt('global')).toMatchObject({ count: ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT, notified: true });
  });

  it('rolls back the global reservation when the device limit rejects the attempt', async () => {
    for (let index = 0; index < ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT; index += 1) await verify('0000');
    await expect(verify('0000')).rejects.toMatchObject(rateLimited);
    expect((await attempt('global')).count).toBe(ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT);
  });
});
