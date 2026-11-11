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

  it('returns 409 after exactly three raw SQL serialization failures', async () => {
    mocks.transaction.mockRejectedValue(known('P2010', { driverAdapterError: { cause: { originalCode: '40001' } } }));
    await expect(runDueDateTransaction(vi.fn())).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });
});
