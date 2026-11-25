import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID as dashboardId } from '../../services/production-schedule/constants.js';
import { calculateProductionScheduleDataHash } from '../../services/production-schedule/row-resolver/constants.js';
import { buildMaxProductNoWinnerCondition } from '../../services/production-schedule/row-resolver/max-product-no-sql.js';
import {
  buildProductionScheduleRowHashPartSql,
  buildProductionScheduleRowHashSql,
  buildProductionScheduleRowHashUnsafeConditionSql,
} from '../production-schedule-row-hash-sql.js';
import { verifyProductionScheduleRowHash } from '../verify-production-schedule-row-hash.js';

const migrationSql = readFileSync(
  new URL('../../../prisma/migrations/20261125110000_keep_all_manufacturing_orders_rehash/migration.sql', import.meta.url),
  'utf8'
);
// The migration owns BEGIN/COMMIT. The tests run its body inside their own transaction and roll it back.
const migrationBody = migrationSql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');

class Rollback extends Error {}

type Tx = Prisma.TransactionClient;

async function inRolledBackTransaction(work: (tx: Tx) => Promise<void>): Promise<void> {
  let caught: unknown;
  await prisma.$transaction(async (tx) => {
      // The shared test database may hold rows of this dashboard from other tests.
      await tx.csvDashboardRow.deleteMany({ where: { csvDashboardId: dashboardId } });
      await work(tx);
      throw new Rollback();
    }, { timeout: 60000 }).catch((error: unknown) => { caught = error; });
  if (!(caught instanceof Rollback)) throw caught;
}

const legacyHash = (row: Record<string, unknown>): string =>
  createHash('sha256')
    .update(['FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'].map((c) => String(row[c]).trim().toLowerCase()).join('|'))
    .digest('hex');

const rowKey = (parts: string[]): string => `row:${Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url')}`;

const normal = { FSEIBAN: 'ab1234', FHINCD: 'PART-A', FSIGENCD: '200', FKOJUN: '10', ProductNo: '0004146538' };
const winnerNo = { ...normal, ProductNo: '0004146555' };
const unassigned = { FSEIBAN: '********', FHINCD: 'PART-U', FSIGENCD: '300', FKOJUN: '20', ProductNo: '0009000001' };
const exotic = {
  FSEIBAN: '　Ａｂ12 ',
  FHINCD: '\tＭＤ００５　ｘ﻿',
  FSIGENCD: ' ２００ ',
  FKOJUN: ' 1 0 ',
  ProductNo: ' 0004146999 ',
};

async function createRow(tx: Tx, rowData: Record<string, unknown>, dataHash: string | null, createdAt?: Date) {
  return tx.csvDashboardRow.create({
    data: { csvDashboardId: dashboardId, rowData: rowData as Prisma.InputJsonValue, occurredAt: new Date(), dataHash, ...(createdAt ? { createdAt } : {}) },
  });
}

describe('keep all manufacturing orders: rehash migration', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.upsert({
      where: { id: dashboardId },
      create: { id: dashboardId, name: 'rehash-migration', columnDefinitions: [], templateConfig: {} },
      update: {},
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('the migration embeds exactly the SQL expressions the verification script evaluates', () => {
    expect(migrationSql).toContain(buildProductionScheduleRowHashSql('r'));
    expect(migrationSql).toContain(buildProductionScheduleRowHashUnsafeConditionSql('r'));
    expect(buildProductionScheduleRowHashPartSql('r', 'FHINCD')).toContain(`r."rowData"->>'FHINCD'`);
  });

  it('keeps ids, rewrites hashes to the TypeScript five-element hash, and carries RowSeen and board keys', async () => {
    await inRolledBackTransaction(async (tx) => {
      const seen = new Date('2026-11-24T20:00:00.000Z');
      const rows = [
        await createRow(tx, normal, legacyHash(normal), new Date('2026-11-01T00:00:00Z')),
        await createRow(tx, winnerNo, legacyHash(winnerNo), new Date('2026-11-02T00:00:00Z')),
        await createRow(tx, unassigned, calculateProductionScheduleDataHash(unassigned)),
        await createRow(tx, exotic, legacyHash(exotic)),
      ];
      const ids = rows.map((row) => row.id);
      await tx.productionScheduleRowSeen.createMany({
        data: [...new Set(rows.map((row) => row.dataHash!))].map((dataHash) => ({ dataHash, lastSeenAt: seen })),
      });
      const site = 'rehash-site';
      const legacyKey = rowKey([normal.FSEIBAN, normal.FHINCD, normal.FSIGENCD, normal.FKOJUN]);
      const exoticLegacyKey = rowKey([exotic.FSEIBAN, exotic.FHINCD, exotic.FSIGENCD, exotic.FKOJUN]);
      const unassignedKey = rowKey([unassigned.FSEIBAN, unassigned.FHINCD, unassigned.FSIGENCD, unassigned.FKOJUN, unassigned.ProductNo]);
      for (const itemKey of [legacyKey, exoticLegacyKey, unassignedKey, 'piece:abc', 'pieceops:abc:2']) {
        await tx.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId, siteKey: site, itemKey, orderPinned: true } });
        await tx.productionScheduleGrindingPlanningBoardArrival.create({ data: { csvDashboardId: dashboardId, siteKey: site, itemKey, arrivalDate: new Date('2026-11-20') } });
        await tx.productionScheduleGrindingPlanningBoardFirstProcessArrival.create({ data: { csvDashboardId: dashboardId, siteKey: site, itemKey, state: 'arrived', recordedAt: seen } });
      }

      const before = await verifyProductionScheduleRowHash(tx);
      expect(before).toMatchObject({ totalRows: 4, mismatchCount: 0, unsafeValueCount: 0 });

      await tx.$executeRawUnsafe(migrationBody);

      const after = await tx.csvDashboardRow.findMany({ where: { id: { in: ids } } });
      expect(after.map((row) => row.id).sort()).toEqual([...ids].sort());
      for (const row of after) {
        expect(row.dataHash).toBe(calculateProductionScheduleDataHash(row.rowData as Record<string, unknown>));
      }
      expect(after.find((row) => row.id === rows[0].id)?.dataHash).not.toBe(legacyHash(normal));
      // Unassigned rows were already five-element and keep their hash.
      expect(after.find((row) => row.id === rows[2].id)?.dataHash).toBe(rows[2].dataHash);

      for (const row of after) {
        const next = await tx.productionScheduleRowSeen.findUnique({ where: { dataHash: row.dataHash! } });
        expect(next?.lastSeenAt.toISOString()).toBe(seen.toISOString());
      }
      // Old hashes are kept.
      expect(await tx.productionScheduleRowSeen.findUnique({ where: { dataHash: legacyHash(normal) } })).not.toBeNull();

      // Key of the winner (highest ProductNo) gets its ProductNo appended; unassigned and piece keys are untouched.
      const expected = [
        rowKey([normal.FSEIBAN, normal.FHINCD, normal.FSIGENCD, normal.FKOJUN, winnerNo.ProductNo]),
        rowKey([exotic.FSEIBAN, exotic.FHINCD, exotic.FSIGENCD, exotic.FKOJUN, exotic.ProductNo]),
        unassignedKey,
        'piece:abc',
        'pieceops:abc:2',
      ].sort();
      const keys = [
        (await tx.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: site } })).map((r) => r.itemKey),
        (await tx.productionScheduleGrindingPlanningBoardArrival.findMany({ where: { siteKey: site } })).map((r) => r.itemKey),
        (await tx.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany({ where: { siteKey: site } })).map((r) => r.itemKey),
      ];
      for (const list of keys) expect([...list].sort()).toEqual(expected);

      expect(await verifyProductionScheduleRowHash(tx)).toMatchObject({ totalRows: 4, mismatchCount: 0 });
    });
  });

  it('sets the dashboard dedupKeyColumns to the five columns', async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx.csvDashboard.update({ where: { id: dashboardId }, data: { dedupKeyColumns: ['FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'] } });
      await tx.$executeRawUnsafe(migrationBody);
      const dashboard = await tx.csvDashboard.findUniqueOrThrow({ where: { id: dashboardId } });
      expect(dashboard.dedupKeyColumns).toEqual(['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN']);
    });
  });

  it('is a no-op the second time', async () => {
    await inRolledBackTransaction(async (tx) => {
      const row = await createRow(tx, normal, legacyHash(normal));
      await tx.$executeRawUnsafe(migrationBody);
      const first = await tx.csvDashboardRow.findUniqueOrThrow({ where: { id: row.id } });
      // The temp tables live until the transaction ends; a real second run is a new transaction.
      await tx.$executeRawUnsafe('DROP TABLE production_schedule_rehash, production_schedule_rehash_item_keys');
      await tx.$executeRawUnsafe(migrationBody);
      const second = await tx.csvDashboardRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(second.dataHash).toBe(first.dataHash);
    });
  });

  const expectAbort = async (message: string, setup: (tx: Tx) => Promise<void>) => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.csvDashboardRow.deleteMany({ where: { csvDashboardId: dashboardId } });
        await setup(tx);
        await tx.$executeRawUnsafe(migrationBody);
      }, { timeout: 60000 })
    ).rejects.toThrow(message);
  };

  it('aborts on duplicate five-element identities', async () => {
    await expectAbort('Duplicate production schedule order identity', async (tx) => {
      await createRow(tx, normal, 'dup-a');
      await createRow(tx, { ...normal, FHINCD: ' PART-A ' }, 'dup-b');
    });
  });

  it('aborts on a missing key field', async () => {
    await expectAbort('Production schedule key has a missing field', async (tx) => {
      await createRow(tx, { ...normal, ProductNo: '' }, 'missing');
    });
  });

  it.each([
    ['Greek capital sigma', 'ΑΣ'],
    ['dotted capital I', 'İ-1'],
    ['Roman numeral', 'Ⅻ'],
  ])('aborts when a value (%s) could lower-case differently from JavaScript', async (_name, value) => {
    await expectAbort('may differ from the TypeScript hash', async (tx) => {
      await createRow(tx, { ...normal, FHINCD: value }, 'unsafe');
    });
  });

  it('aborts when a value is not a string', async () => {
    await expectAbort('may differ from the TypeScript hash', async (tx) => {
      await createRow(tx, { ...normal, FKOJUN: 10 }, 'number');
    });
  });

  it.each([
    ['Override', (tx: Tx, itemKey: string) => tx.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId, siteKey: 's', itemKey } })],
    ['Arrival', (tx: Tx, itemKey: string) => tx.productionScheduleGrindingPlanningBoardArrival.create({ data: { csvDashboardId: dashboardId, siteKey: 's', itemKey, arrivalDate: new Date('2026-11-20') } })],
    ['FirstProcessArrival', (tx: Tx, itemKey: string) => tx.productionScheduleGrindingPlanningBoardFirstProcessArrival.create({ data: { csvDashboardId: dashboardId, siteKey: 's', itemKey, state: 'arrived', recordedAt: new Date() } })],
  ])('aborts when the rewritten %s key already exists', async (_name, create) => {
    await expectAbort('collides', async (tx) => {
      await createRow(tx, normal, legacyHash(normal));
      await create(tx, rowKey([normal.FSEIBAN, normal.FHINCD, normal.FSIGENCD, normal.FKOJUN]));
      await create(tx, rowKey([normal.FSEIBAN, normal.FHINCD, normal.FSIGENCD, normal.FKOJUN, normal.ProductNo]));
    });
  });
});

describe('superseded marker and winner condition on a real database', () => {
  it('returns both order numbers of one four-column key, and only the unmarked one when one is superseded', async () => {
    await prisma.csvDashboard.upsert({
      where: { id: dashboardId },
      create: { id: dashboardId, name: 'rehash-migration', columnDefinitions: [], templateConfig: {} },
      update: {},
    });
    await inRolledBackTransaction(async (tx) => {
      const a = await createRow(tx, normal, 'w-a');
      const b = await createRow(tx, winnerNo, 'w-b');
      const select = async () => (await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "CsvDashboardRow"."id" FROM "CsvDashboardRow"
        WHERE "CsvDashboardRow"."csvDashboardId" = ${dashboardId} AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      `).map((row) => row.id).sort();
      expect(await select()).toEqual([a.id, b.id].sort());
      await tx.csvDashboardRow.update({ where: { id: a.id }, data: { supersededAt: new Date() } });
      expect(await select()).toEqual([b.id]);
      await tx.csvDashboardRow.update({ where: { id: a.id }, data: { supersededAt: null } });
      expect(await select()).toEqual([a.id, b.id].sort());
    });
  });
});
