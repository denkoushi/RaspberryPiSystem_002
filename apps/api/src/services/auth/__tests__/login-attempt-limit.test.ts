import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { AuthService } from '../auth.service.js';

const service = new AuthService();
const password = 'login-attempt-test-password';
const passwordHash = bcrypt.hashSync(password, 4);
const limited = { statusCode: 429, code: 'AUTH_LOGIN_RATE_LIMITED' };
const unauthorized = { statusCode: 401 };
let username: string;
let user: User | undefined;
let extraUsernames: string[];
const login = (input: { password?: string; totpCode?: string } = {}) => service.login({ username, password, ...input });
const attempt = () => prisma.authLoginAttempt.findUnique({ where: { username } });

beforeEach(async () => {
  username = `login-limit-${randomUUID()}`;
  extraUsernames = [];
  user = undefined;
  user = await prisma.user.create({ data: { username, passwordHash, role: 'VIEWER' } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.authLoginAttempt.deleteMany({ where: { username: { in: [username, ...extraUsernames] } } });
  if (user) await prisma.user.delete({ where: { id: user.id } });
});

describe('account login attempt accounting', () => {
  it('counts ten failures and rejects correct credentials on the eleventh attempt', async () => {
    const startedAt = Date.now();
    for (let index = 0; index < 10; index += 1) {
      await expect(login({ password: 'wrong' })).rejects.toMatchObject(unauthorized);
    }
    const saved = await attempt();
    expect(saved?.count).toBe(10);
    expect(saved!.windowEndsAt.getTime()).toBeGreaterThanOrEqual(startedAt + 15 * 60_000);
    expect(saved!.windowEndsAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    const compare = vi.spyOn(bcrypt, 'compare');
    await expect(login()).rejects.toMatchObject(limited);
    expect(compare).not.toHaveBeenCalled();
    expect(await attempt()).toEqual(saved);
  });

  it('starts a new window after expiration and accepts correct credentials again', async () => {
    await prisma.authLoginAttempt.create({ data: { username, count: 10, windowEndsAt: new Date(0) } });
    await expect(login({ password: 'wrong' })).rejects.toMatchObject(unauthorized);
    expect(await attempt()).toMatchObject({ count: 1 });
    expect((await attempt())!.windowEndsAt.getTime()).toBeGreaterThan(Date.now());
    await expect(login()).resolves.toMatchObject({ user: { username } });
    expect(await attempt()).toBeNull();
  });

  it('clears earlier failures on success and counts subsequent failures from one', async () => {
    for (let index = 0; index < 9; index += 1) {
      await expect(login({ password: 'wrong' })).rejects.toMatchObject(unauthorized);
    }
    await expect(login()).resolves.toMatchObject({ user: { username } });
    expect(await attempt()).toBeNull();
    await expect(login({ password: 'wrong' })).rejects.toMatchObject(unauthorized);
    expect(await attempt()).toMatchObject({ count: 1 });
  });

  it('counts unknown usernames and compares once per reserved attempt', async () => {
    await prisma.user.delete({ where: { id: user!.id } });
    user = undefined;
    const compare = vi.spyOn(bcrypt, 'compare');
    for (let index = 0; index < 10; index += 1) {
      await expect(login()).rejects.toMatchObject(unauthorized);
    }
    await expect(login()).rejects.toMatchObject(limited);
    expect(compare).toHaveBeenCalledTimes(10);
    expect(await attempt()).toMatchObject({ count: 10 });
  });

  it('keeps inactive accounts and MFA failures in the count', async () => {
    await prisma.user.update({ where: { id: user!.id }, data: { status: 'DISABLED' } });
    await expect(login()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: user!.id }, data: { status: 'ACTIVE', mfaEnabled: true } });
    await expect(login()).rejects.toMatchObject(unauthorized);
    expect(await attempt()).toMatchObject({ count: 2 });
  });

  it('preserves case and whitespace as distinct username lookups', async () => {
    extraUsernames = [username.toUpperCase(), ` ${username} `];
    for (const variant of extraUsernames) {
      await expect(service.login({ username: variant, password })).rejects.toMatchObject(unauthorized);
      expect(await prisma.authLoginAttempt.findUnique({ where: { username: variant } })).toMatchObject({ count: 1 });
    }
    expect(await attempt()).toBeNull();
    await expect(login()).resolves.toMatchObject({ user: { username } });
  });

  it('reserves at most ten comparisons across concurrent failed requests', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => login({ password: 'wrong' })));
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    expect(errors.filter((error) => error.statusCode === 401)).toHaveLength(10);
    expect(errors.filter((error) => error.code === 'AUTH_LOGIN_RATE_LIMITED')).toHaveLength(5);
    expect(compare).toHaveBeenCalledTimes(10);
    expect(await attempt()).toMatchObject({ count: 10 });
    await expect(login()).rejects.toMatchObject(limited);
  });

  it('removes at most one hundred expired rows per reservation', async () => {
    extraUsernames = Array.from({ length: 105 }, () => `expired-login-${randomUUID()}`);
    await prisma.authLoginAttempt.createMany({ data: extraUsernames.map((name) => ({
      username: name, count: 10, windowEndsAt: new Date(0)
    })) });
    const execute = vi.spyOn(prisma, '$executeRaw');
    await expect(login({ password: 'wrong' })).rejects.toMatchObject(unauthorized);
    const removed = await execute.mock.results[0].value;
    expect(removed).toBeLessThanOrEqual(100);
    expect(removed).toBeGreaterThan(0);
    expect(await prisma.authLoginAttempt.count({ where: { username: { in: extraUsernames } } })).toBeGreaterThanOrEqual(5);
  });
});

describe('login TOTP steps', () => {
  const epoch = 1_800_000_000_000;
  let secret: string;
  const codeAt = (time: number) => {
    const generator = authenticator.clone();
    generator.options = { epoch: time };
    return generator.generate(secret);
  };

  beforeEach(async () => {
    secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: user!.id }, data: { mfaEnabled: true, totpSecret: secret } });
    vi.spyOn(Date, 'now').mockReturnValue(epoch);
  });

  it('rejects a reused or older step and accepts the next step', async () => {
    await expect(login({ totpCode: codeAt(epoch) })).resolves.toMatchObject({ user: { username } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user!.id } })).totpLastUsedStep).toBe(epoch / 30_000);
    await expect(login({ totpCode: codeAt(epoch) })).rejects.toMatchObject(unauthorized);
    vi.mocked(Date.now).mockReturnValue(epoch - 30_000);
    await expect(login({ totpCode: codeAt(epoch - 30_000) })).rejects.toMatchObject(unauthorized);
    vi.mocked(Date.now).mockReturnValue(epoch + 30_000);
    await expect(login({ totpCode: codeAt(epoch + 30_000) })).resolves.toMatchObject({ user: { username } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user!.id } })).totpLastUsedStep).toBe(epoch / 30_000 + 1);
  });

  it('accepts only one of two concurrent logins with the same step', async () => {
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => login({ totpCode: codeAt(epoch) })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject(unauthorized);
  });
});
