import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { rebuildProductionSchedulePartNameLookup } from '../../production-schedule/production-schedule-part-name-lookup.js';
import { readPartNamesByPartNumbers, readPartNamesByPartNumbersLegacy } from '../repositories/prisma-work-instruction-part-names.js';

// Roll back fixtures, lookup and state together, including when an assertion fails.
async function withFixture(run: (tx: Prisma.TransactionClient, parts: string[]) => Promise<void>) {
  const rollback = new Error('rollback fixture');
  try {
    await prisma.$transaction(async (tx) => {
      const otherId = randomUUID();
      for (const id of [PRODUCTION_SCHEDULE_DASHBOARD_ID, otherId]) {
        await tx.csvDashboard.upsert({ where: { id }, update: {}, create: {
          id, name: 'part-name-lookup-test', columnDefinitions: [], templateConfig: {},
        } });
      }
      const prefix = `LOOKUP-${randomUUID()}-`;
      const key = (suffix: string) => prefix + suffix;
      const data: Prisma.InputJsonObject[] = [
        { FHINCD: ` ${key('ａｂ1')} `, FHINMEI: ' Z name ' },
        { FHINCD: key('ab1'), FHINMEI: ' A name ' },
        { FHINCD: key('AB1'), FHINMEI: '' },
        { FHINCD: key('AB1'), FHINMEI: '   ' },
        { FHINCD: key('AB1'), FHINMEI: null },
        { FHINCD: key('AB1') },
        { FHINCD: key('empty'), FHINMEI: '' },
        { FHINCD: key('space'), FHINMEI: '  ' },
        { FHINCD: key('null'), FHINMEI: null },
        { FHINCD: key('missing') },
        { FHINCD: '', FHINMEI: 'Empty key' },
        { FHINCD: '   ', FHINMEI: 'Whitespace key' },
        { FHINCD: null, FHINMEI: 'Null key' },
        { FHINMEI: 'Missing key' },
      ];
      await tx.csvDashboardRow.createMany({ data: data.map((rowData) => ({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(), rowData,
      })) });
      await tx.csvDashboardRow.createMany({ data: [
        { csvDashboardId: otherId, occurredAt: new Date(), rowData: { FHINCD: key('AB1'), FHINMEI: '0 ignored' } },
        { csvDashboardId: otherId, occurredAt: new Date(), rowData: { FHINCD: key('other'), FHINMEI: 'Ignored' } },
      ] });
      await run(tx, ['ab1', 'empty', 'space', 'null', 'missing', 'other', 'absent'].map(key).concat(['', '   ']));
      throw rollback;
    }, { timeout: 120_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

// Reuse the fixture's real transaction so all changes are rolled back after the assertion.
const inTransaction = (tx: Prisma.TransactionClient) => ({
  $transaction: async (run: (client: Prisma.TransactionClient) => Promise<void>) => run(tx),
}) as unknown as Pick<PrismaClient, '$transaction'>;

describe('production schedule part name lookup (DB)', () => {
  afterAll(() => prisma.$disconnect());

  it('matches the legacy aggregate exactly for normalization, MIN, nulls and dashboard scope', async () => {
    await withFixture(async (tx, parts) => {
      const legacy = await readPartNamesByPartNumbersLegacy(tx, parts);
      await rebuildProductionSchedulePartNameLookup(inTransaction(tx));
      expect(await readPartNamesByPartNumbers(tx, parts)).toEqual(legacy);
      expect([...legacy.values()]).toEqual(expect.arrayContaining(['A name', null]));
      const nullKeys = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "ProductionSchedulePartNameLookup" WHERE "partNumberKey" IS NULL
      `;
      expect(nullKeys[0]?.count).toBe(0n);
      expect(await tx.productionSchedulePartNameLookup.findUnique({ where: { partNumberKey: '' } })).not.toBeNull();
    });
  });

  it('falls back to the legacy aggregate when no state exists', async () => {
    await withFixture(async (tx, parts) => {
      await tx.productionSchedulePartNameLookupState.deleteMany();
      await tx.productionSchedulePartNameLookup.deleteMany();
      expect(await readPartNamesByPartNumbers(tx, parts)).toEqual(await readPartNamesByPartNumbersLegacy(tx, parts));
    });
  });
});
