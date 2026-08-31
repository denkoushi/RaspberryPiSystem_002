import { Prisma, PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { backfillWorkInstructionSourceVersions } from '../work-instruction-source-version-backfill.service.js';

function emptyDatabase() {
  const findMany = vi.fn().mockResolvedValue([]);
  return {
    db: {
      workInstructionRow: { findMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient,
    findMany,
  };
}

describe('backfillWorkInstructionSourceVersions edge cases', () => {
  it.each([0, -1, 1.5, 1_001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid batch size (%s)',
    async (batchSize) => {
      await expect(
        backfillWorkInstructionSourceVersions({} as PrismaClient, { batchSize }),
      ).rejects.toThrow('batchSize must be an integer between 1 and 1000');
    },
  );

  it('stops cleanly when the legacy table is empty and uses the default batch size', async () => {
    const fixture = emptyDatabase();

    await expect(backfillWorkInstructionSourceVersions(fixture.db)).resolves.toEqual({
      scanned: 0,
      created: 0,
      alreadyPresent: 0,
      raced: 0,
    });
    expect(fixture.findMany).toHaveBeenCalledWith({
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
  });

  it('counts a legacy row that disappears before its transaction as already present', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'row-gone' }]);
    const findUniquePublication = vi.fn().mockResolvedValue(null);
    const findUniqueRow = vi.fn().mockResolvedValue(null);
    const transaction = {
      workInstructionSourcePublication: { findUnique: findUniquePublication },
      workInstructionRow: { findUnique: findUniqueRow },
    };
    const runTransaction = vi.fn(async (callback: (tx: typeof transaction) => Promise<boolean>) => callback(transaction));
    const db = {
      workInstructionRow: { findMany },
      $transaction: runTransaction,
    } as unknown as PrismaClient;

    await expect(backfillWorkInstructionSourceVersions(db, { batchSize: 10 })).resolves.toEqual({
      scanned: 1,
      created: 0,
      alreadyPresent: 1,
      raced: 0,
    });
    expect(findUniquePublication).toHaveBeenCalledWith({ where: { rowId: 'row-gone' } });
    expect(findUniqueRow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'row-gone' } }));
  });

  it('reports a concurrent publication unique-key race without failing the whole backfill', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'row-raced' }]);
    const race = new Prisma.PrismaClientKnownRequestError('duplicate publication', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const runTransaction = vi.fn().mockRejectedValue(race);
    const db = {
      workInstructionRow: { findMany },
      $transaction: runTransaction,
    } as unknown as PrismaClient;

    await expect(backfillWorkInstructionSourceVersions(db, { batchSize: 10 })).resolves.toEqual({
      scanned: 1,
      created: 0,
      alreadyPresent: 0,
      raced: 1,
    });
  });

  it('rethrows non-unique transaction failures for retry visibility', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'row-failed' }]);
    const runTransaction = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const db = {
      workInstructionRow: { findMany },
      $transaction: runTransaction,
    } as unknown as PrismaClient;

    await expect(backfillWorkInstructionSourceVersions(db, { batchSize: 10 })).rejects.toThrow(
      'database unavailable',
    );
  });
});
