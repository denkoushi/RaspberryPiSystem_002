import type { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cooperativeAutoUnitSplitTransaction, type AutoUnitSplitMetrics } from '../auto-unit-split-transaction.js';

afterEach(() => vi.restoreAllMocks());
describe('automatic transaction cooperation', () => {
  const setup = () => {
    const metrics: AutoUnitSplitMetrics = { writtenRowCount: 0, lockHeldMs: 0, yieldReason: null };
    const raw = { $queryRaw: vi.fn().mockResolvedValue([{ waiting: false }]),
      $executeRaw: vi.fn().mockResolvedValue(7),
      productionScheduleSessakuPiece: { createMany: vi.fn().mockResolvedValue({ count: 5 }) } };
    return { raw, metrics, ...cooperativeAutoUnitSplitTransaction(raw as unknown as Prisma.TransactionClient, metrics) };
  };
  it('yields before another write when a human is waiting', async () => {
    const { raw, tx } = setup();
    raw.$queryRaw.mockResolvedValue([{ waiting: true }]);
    await expect(tx.productionScheduleSessakuPiece.createMany({ data: [] })).rejects.toMatchObject({ code: 'AUTO_UNIT_SPLIT_YIELD' });
    expect(raw.productionScheduleSessakuPiece.createMany).not.toHaveBeenCalled();
  });
  it('detects a waiter arriving during a write', async () => {
    const { raw, tx } = setup();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    raw.productionScheduleSessakuPiece.createMany.mockImplementation(async () => {
      now.mockReturnValue(30);
      raw.$queryRaw.mockResolvedValue([{ waiting: true }]);
      return { count: 5 };
    });
    await expect(tx.productionScheduleSessakuPiece.createMany({ data: [] })).rejects.toMatchObject({ code: 'AUTO_UNIT_SPLIT_YIELD' });
  });
  it('always checks before commit, even inside the probe interval', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { raw, check, tx, metrics } = setup();
    await tx.productionScheduleSessakuPiece.createMany({ data: [] });
    expect(raw.$queryRaw).toHaveBeenCalledTimes(1);
    expect(metrics.writtenRowCount).toBe(5);
    raw.$queryRaw.mockResolvedValue([{ waiting: true }]);
    await expect(check(true)).rejects.toMatchObject({ code: 'AUTO_UNIT_SPLIT_YIELD' });
  });
  it('measures actual probes, including a forced check inside the interval and a failed probe', async () => {
    const { raw, check, metrics } = setup();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    raw.$queryRaw.mockImplementationOnce(async () => {
      now.mockReturnValue(4);
      return [{ waiting: false }];
    });
    await check();
    await check(); // Throttled: no SQL and no extra count/time.
    expect(metrics).toMatchObject({ yieldCheckCount: 1, yieldCheckMs: 4 });
    raw.$queryRaw.mockImplementationOnce(async () => {
      now.mockReturnValue(11);
      throw new Error('probe failed');
    });
    await expect(check(true)).rejects.toThrow('probe failed');
    expect(metrics).toMatchObject({ yieldCheckCount: 2, yieldCheckMs: 11 });
    expect(raw.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it('counts affected rows while excluding lock and SAVEPOINT SQL', async () => {
    const { tx, metrics } = setup();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1)`;
    await tx.$executeRaw`SAVEPOINT auto_unit_split_lot`;
    await tx.$executeRaw({ sql: 'INSERT INTO placements VALUES (1)' } as Prisma.Sql);
    expect(metrics.writtenRowCount).toBe(7);
  });
});
