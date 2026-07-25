import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailRequestGateService, GmailRateLimitedDeferredError } from '../gmail-request-gate.service.js';
import { ProcessWideFifoGmailRequestSerializer } from '../../gmail/gmail-request-serializer.js';

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
        cooldownUntil: new Date(baseNow.getTime() + 15 * 60_000),
        last429At: baseNow,
        lastRetryAfterMs: 15 * 60_000,
        version: { increment: 1 },
      }),
    });
  });

  it('does not start the next request until 429 cooldown persistence finishes', async () => {
    const baseNow = new Date('2026-02-19T12:00:00.000Z');
    const state = {
      id: 'gmail:me',
      cooldownUntil: null,
      last429At: null,
      lastRetryAfterMs: null,
      version: 3,
    };
    gmailRateLimitStateMock.findUnique.mockResolvedValue(state);
    let finishPersistence!: (value: { count: number }) => void;
    gmailRateLimitStateMock.updateMany.mockReturnValueOnce(
      new Promise((resolve) => {
        finishPersistence = resolve;
      })
    );
    const serializer = new ProcessWideFifoGmailRequestSerializer();
    const firstGate = new GmailRequestGateService({
      now: () => baseNow,
      jitterMaxMs: 0,
      cacheTtlMs: 0,
      requestSerializer: serializer,
    });
    const secondGate = new GmailRequestGateService({
      now: () => baseNow,
      cacheTtlMs: 0,
      requestSerializer: serializer,
    });
    const secondRequest = vi.fn(async () => 'second-ok');

    const first = firstGate.execute(
      'first',
      async () => {
        throw { status: 429, message: 'rate limit' };
      },
      { allowWait: false }
    );
    const firstOutcome = expect(first).rejects.toBeInstanceOf(GmailRateLimitedDeferredError);
    await vi.waitFor(() => expect(gmailRateLimitStateMock.updateMany).toHaveBeenCalledOnce());
    const second = secondGate.execute('second', secondRequest, { allowWait: false });
    await Promise.resolve();
    expect(secondRequest).not.toHaveBeenCalled();

    finishPersistence({ count: 1 });
    await firstOutcome;
    await expect(second).resolves.toBe('second-ok');
    expect(secondRequest).toHaveBeenCalledOnce();
  });

  it('waits for an existing cooldown outside the exclusive request slot', async () => {
    const baseNow = new Date('2026-02-19T12:00:00.000Z');
    const cooldownUntil = new Date(baseNow.getTime() + 60_000);
    const activeState = {
      id: 'gmail:me',
      cooldownUntil,
      last429At: baseNow,
      lastRetryAfterMs: 60_000,
      version: 1,
    };
    const normalState = {
      ...activeState,
      cooldownUntil: null,
    };
    gmailRateLimitStateMock.findUnique
      .mockResolvedValueOnce(activeState)
      .mockResolvedValue(normalState);

    let now = baseNow;
    let finishSleep!: () => void;
    const sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSleep = () => {
            now = new Date(cooldownUntil.getTime() + 1);
            resolve();
          };
        })
    );
    const serializer = new ProcessWideFifoGmailRequestSerializer();
    const waitingGate = new GmailRequestGateService({
      now: () => now,
      sleep,
      cacheTtlMs: 0,
      requestSerializer: serializer,
    });
    const immediateGate = new GmailRequestGateService({
      now: () => now,
      cacheTtlMs: 0,
      requestSerializer: serializer,
    });
    const waitingRequest = vi.fn(async () => 'waited');
    const immediateRequest = vi.fn(async () => 'immediate');

    const waiting = waitingGate.execute('waiting', waitingRequest, { allowWait: true });
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledOnce());
    await expect(
      immediateGate.execute('immediate', immediateRequest, { allowWait: false })
    ).resolves.toBe('immediate');
    expect(waitingRequest).not.toHaveBeenCalled();

    finishSleep();
    await expect(waiting).resolves.toBe('waited');
  });
});
