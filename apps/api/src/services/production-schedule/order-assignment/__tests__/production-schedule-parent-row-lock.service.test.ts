import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { acquireProductionScheduleParentRowLocksInTransaction } from '../production-schedule-parent-row-lock.service.js';

describe('batched parent advisory locks', () => {
  it('uses the existing sha256 lock IDs in caller order with one statement', async () => {
    const execute = vi.fn();
    const tx = { $executeRaw: execute } as unknown as Prisma.TransactionClient;
    const ids = ['a', 'b', 'z'];
    await acquireProductionScheduleParentRowLocksInTransaction(tx, ids);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toEqual(ids.map((id) => createHash('sha256').update(id).digest().readBigInt64BE(0)));
    expect(execute.mock.calls[0][0].join('')).toContain('WITH ORDINALITY AS locks(lock_id, position) ORDER BY position');
  });
  it('does not query for an empty row list', async () => {
    const execute = vi.fn();
    await acquireProductionScheduleParentRowLocksInTransaction({ $executeRaw: execute } as unknown as Prisma.TransactionClient, []);
    expect(execute).not.toHaveBeenCalled();
  });
});
