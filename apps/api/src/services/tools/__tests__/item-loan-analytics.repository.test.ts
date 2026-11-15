import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

// Use Prisma's real SQL helpers without loading a generated DB client.
vi.mock('@prisma/client', async () => {
  const { sqltag, join, raw, empty } = await import('@prisma/client/runtime/client');
  return { Prisma: { sql: sqltag, join, raw, empty } };
});
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));
import { ItemLoanAnalyticsRepository } from '../item-loan-analytics.repository.js';

describe('ItemLoanAnalyticsRepository retained history', () => {
  it('uses photoTakenAt in every SQL and Prisma photo-loan scope after photoUrl is cleared', async () => {
    const queries: string[] = [];
    const db = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        queries.push(Prisma.sql(strings, ...values).sql);
        return [];
      }),
      loan: { count: vi.fn().mockResolvedValue(1), groupBy: vi.fn().mockResolvedValue([]) },
    };
    const repo = new ItemLoanAnalyticsRepository(db as unknown as ConstructorParameters<typeof ItemLoanAnalyticsRepository>[0]);
    const result = await repo.loadAggregate({
      periodFrom: new Date('2025-01-01'), periodTo: new Date('2026-11-15'),
      now: new Date('2026-11-15'), monthlyMonths: 6, timeZone: 'Asia/Tokyo',
    });
    expect(result.periodBorrowCount).toBe(1);
    expect(result.periodReturnCount).toBe(1);
    expect(queries).toHaveLength(4);
    for (const sql of queries) {
      expect(sql).toContain('l."photoTakenAt" IS NOT NULL');
      expect(sql).not.toContain('l."photoUrl" IS NOT NULL');
      expect(sql).toContain('l."photoToolGallerySeed" = false');
      expect(sql).toContain('l."cancelledAt" IS NULL');
    }
    for (const [args] of [...db.loan.count.mock.calls, ...db.loan.groupBy.mock.calls]) {
      expect(args.where.AND[0]).toEqual({
        photoTakenAt: { not: null }, itemId: null, riggingGearId: null,
        measuringInstrumentId: null, cancelledAt: null, photoToolGallerySeed: false,
      });
    }
  });

  it('still resolves a photo-tool label using the timestamp scope', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ tl: 'ドリル' }]) };
    const repo = new ItemLoanAnalyticsRepository(db as unknown as ConstructorParameters<typeof ItemLoanAnalyticsRepository>[0]);
    const id = `pt-${createHash('sha256').update('ドリル').digest('hex').slice(0, 24)}`;
    expect(await repo.resolveSyntheticItemIdToToolLabel(id)).toBe('ドリル');
    const [strings, ...values] = db.$queryRaw.mock.calls[0];
    expect(Prisma.sql(strings, ...values).sql).toContain('l."photoTakenAt" IS NOT NULL');
  });
});
