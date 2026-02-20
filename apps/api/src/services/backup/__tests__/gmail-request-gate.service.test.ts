import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailRequestGateService, GmailRateLimitedDeferredError } from '../gmail-request-gate.service.js';

const gmailRateLimitStateMock = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    gmailRateLimitState: gmailRateLimitStateMock,
  },
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('GmailRequestGateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should defer without calling fn when cooldown is active (allowWait=false)', async () => {
    const baseNow = new Date('2026-02-19T12:00:00.000Z');
    const cooldownUntil = new Date(baseNow.getTime() + 60_000);

    gmailRateLimitStateMock.findUnique.mockResolvedValueOnce({
      id: 'gmail:me',
      cooldownUntil,
      last429At: null,
      lastRetryAfterMs: null,
      version: 0,
    });

    const gate = new GmailRequestGateService({
      now: () => baseNow,
      cacheTtlMs: 10_000,
    });

    const fn = vi.fn(async () => 'ok');

    await expect(gate.execute('op', fn, { allowWait: false })).rejects.toBeInstanceOf(
      GmailRateLimitedDeferredError
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('should persist cooldown and throw deferred error on 429', async () => {
    const baseNow = new Date('2026-02-19T12:00:00.000Z');

    // state row exists but no cooldown
    gmailRateLimitStateMock.findUnique.mockResolvedValueOnce({
      id: 'gmail:me',
      cooldownUntil: null,
      last429At: null,
      lastRetryAfterMs: null,
      version: 3,
    });
    // persistCooldown() 側でも読み直すため、もう1回同じ行を返す
    gmailRateLimitStateMock.findUnique.mockResolvedValueOnce({
      id: 'gmail:me',
      cooldownUntil: null,
      last429At: null,
      lastRetryAfterMs: null,
      version: 3,
    });
    gmailRateLimitStateMock.updateMany.mockResolvedValueOnce({ count: 1 });

    const gate = new GmailRequestGateService({
      now: () => baseNow,
      jitterMaxMs: 0,
    });

    const err429 = {
      status: 429,
      headers: { 'retry-after': '60' }, // seconds
      message: 'User-rate limit exceeded.',
    };

    const fn = vi.fn(async () => {
      throw err429;
    });

    await expect(gate.execute('gmail.users.messages.list', fn, { allowWait: false })).rejects.toMatchObject({
      name: 'GmailRateLimitedDeferredError',
      operation: 'gmail.users.messages.list',
    });

    expect(gmailRateLimitStateMock.updateMany).toHaveBeenCalledWith({
      where: { id: 'gmail:me', version: 3 },
      data: expect.objectContaining({
        cooldownUntil: new Date(baseNow.getTime() + 60_000),
        last429At: baseNow,
        lastRetryAfterMs: 60_000,
        version: { increment: 1 },
      }),
    });
  });
});

