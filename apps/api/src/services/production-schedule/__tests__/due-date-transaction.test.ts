import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isRetryableDueDateTransactionError, runDueDateTransaction } from '../due-date-transaction.js';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction } }));

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('database error', { code, clientVersion: '7.10.1', meta });

const cases = [
  { name: 'P2034', error: known('P2034'), retry: true },
  ...['40001', '40P01'].flatMap((code) => [
    { name: `adapter P2010/${code}`, error: known('P2010', { driverAdapterError: { cause: { originalCode: code } } }), retry: true },
    { name: `native P2010/${code}`, error: known('P2010', { code }), retry: true }
  ]),
  { name: 'other SQLSTATE', error: known('P2010', { driverAdapterError: { cause: { originalCode: '23505' } } }), retry: false },
  { name: 'missing metadata', error: known('P2010'), retry: false },
  { name: 'other Prisma error', error: known('P2002'), retry: false },
  { name: 'ordinary error', error: new Error('failure'), retry: false },
  { name: 'Prisma-like object', error: { code: 'P2034' }, retry: false }
];

beforeEach(() => vi.resetAllMocks());

describe('due-date transaction retries', () => {
  it.each(cases)('$name: retry=$retry', async ({ error, retry }) => {
    expect(isRetryableDueDateTransactionError(error)).toBe(retry);
    const work = vi.fn();
    mocks.transaction.mockRejectedValueOnce(error).mockResolvedValue('saved');
    if (retry) {
      await expect(runDueDateTransaction(work)).resolves.toBe('saved');
      expect(mocks.transaction).toHaveBeenCalledTimes(2);
      expect(mocks.transaction).toHaveBeenLastCalledWith(work, {
        isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000
      });
    } else {
      await expect(runDueDateTransaction(work)).rejects.toBe(error);
      expect(mocks.transaction).toHaveBeenCalledOnce();
    }
  });

  it.each([undefined, {}, { isolationLevel: 'ReadCommitted' as const }])('passes the requested isolation level: %j', async (options) => {
    const work = vi.fn();
    mocks.transaction.mockResolvedValue('saved');
    await expect(runDueDateTransaction(work, options)).resolves.toBe('saved');
    expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith(work, {
      isolationLevel: options?.isolationLevel ?? 'Serializable', maxWait: 5_000, timeout: 15_000
    });
  });

  it('succeeds on the sixth attempt with increasing jittered waits', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.5).mockReturnValueOnce(0.1).mockReturnValueOnce(0.7);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      mocks.transaction.mockRejectedValue(known('P2034'));
      mocks.transaction.mockRejectedValueOnce(known('P2034')).mockRejectedValueOnce(known('P2034'))
        .mockRejectedValueOnce(known('P2034')).mockRejectedValueOnce(known('P2034'))
        .mockRejectedValueOnce(known('P2034')).mockResolvedValueOnce('saved');
      const result = expect(runDueDateTransaction(vi.fn())).resolves.toBe('saved');
      await vi.runAllTimersAsync();
      await result;
      expect(mocks.transaction).toHaveBeenCalledTimes(6);
      expect(timer.mock.calls.map(([, delay]) => delay)).toEqual([10, 29, 35, 41, 57]);
      expect(random).toHaveBeenCalledTimes(5);
    } finally {
      timer.mockRestore();
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it('returns 409 after exactly six raw SQL serialization failures', async () => {
    mocks.transaction.mockRejectedValue(known('P2010', { driverAdapterError: { cause: { originalCode: '40001' } } }));
    await expect(runDueDateTransaction(vi.fn())).rejects.toMatchObject({ statusCode: 409, message: '他の端末で同時に更新されました。もう一度お試しください' });
    expect(mocks.transaction).toHaveBeenCalledTimes(6);
  });
});
