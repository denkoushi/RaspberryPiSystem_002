import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { rebuildProductionSchedulePartNameLookup } from '../production-schedule-part-name-lookup.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));

describe('part name lookup rebuild transaction', () => {
  it('locks, deletes, inserts and marks built inside one long transaction', async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (query: Prisma.Sql | TemplateStringsArray) => {
      statements.push('sql' in query ? query.sql : query.join('?'));
      return 1;
    });
    const transaction = vi.fn(async (run: (tx: unknown) => Promise<void>) => {
      await run({ $executeRaw: execute });
    });
    await rebuildProductionSchedulePartNameLookup({ $transaction: transaction } as unknown as PrismaClient);
    expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { timeout: 120_000, maxWait: 30_000 });
    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain('pg_advisory_xact_lock');
    expect(statements[1]).toContain('DELETE FROM "ProductionSchedulePartNameLookup"');
    expect(statements[2]).toContain('INSERT INTO "ProductionSchedulePartNameLookup"');
    expect(statements[2]).toContain(`MIN(NULLIF(TRIM("rowData"->>'FHINMEI'), ''))`);
    expect(statements[3]).toContain('INSERT INTO "ProductionSchedulePartNameLookupState"');
  });
});
