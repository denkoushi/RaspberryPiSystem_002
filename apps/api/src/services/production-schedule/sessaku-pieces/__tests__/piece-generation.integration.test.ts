import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../../../lib/prisma-client.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID as dashboardId } from '../../constants.js';
import { readSessakuPieceGeneration, type SessakuPieceLogicalKey } from '../piece-key.js';

const url = process.env.TEST_DATABASE_URL;
const dedicated = Boolean(url) && !['/borrow_return', '/postgres', '/template1'].includes(new URL(url!).pathname);
const client = dedicated ? createPrismaClient(url) : undefined;
const describeDatabase = dedicated ? describe : describe.skip;

// Roll back the complete fixture, including deletions/recreation, without touching other test data.
async function fixture(run: (tx: Prisma.TransactionClient, a: SessakuPieceLogicalKey, b: SessakuPieceLogicalKey) => Promise<void>) {
  const rollback = new Error('rollback generation fixture');
  try {
    await client!.$transaction(async (tx) => {
      await tx.csvDashboard.upsert({ where: { id: dashboardId }, create: { id: dashboardId, name: 'generation', columnDefinitions: [], templateConfig: {} }, update: {} });
      const prefix = `generation-${randomUUID()}`;
      const a = { fseiban: `${prefix}-A`, fhincd: 'P', fsigencd: '021', fkojun: '1' };
      const b = { ...a, fseiban: `${prefix}-B` };
      for (const key of [a, b]) {
        await tx.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, occurredAt: new Date(), dataHash: key.fseiban,
          rowData: { FSEIBAN: key.fseiban, FHINCD: key.fhincd, FSIGENCD: key.fsigencd, FKOJUN: key.fkojun, ProductNo: '1' } } });
        await tx.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...key } });
      }
      await run(tx, a, b);
      throw rollback;
    }, { timeout: 10_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

describeDatabase('piece generation SQL dependencies', () => {
  afterAll(async () => { await client?.$disconnect(); });

  it('isolates A from B while detecting updates, deletion, recreation and global load changes', async () => {
    await fixture(async (tx, a, b) => {
      const scope = { fseibans: [a.fseiban] };
      const where = (key: SessakuPieceLogicalKey) => ({ csvDashboardId_fseiban_fhincd_fsigencd_fkojun: { csvDashboardId: dashboardId, ...key } });
      const before = await readSessakuPieceGeneration(tx, scope);
      const globalBefore = await readSessakuPieceGeneration(tx);
      await tx.productionScheduleSessakuPieceSet.update({ where: where(b), data: { version: { increment: 1 } } });
      expect(await readSessakuPieceGeneration(tx, scope)).toBe(before);
      expect(await readSessakuPieceGeneration(tx)).not.toBe(globalBefore);
      await tx.productionScheduleSessakuPieceSet.update({ where: where(a), data: { version: { increment: 1 } } });
      const updated = await readSessakuPieceGeneration(tx, scope);
      expect(updated).not.toBe(before);
      await tx.productionScheduleSessakuPieceSet.delete({ where: where(a) });
      const deleted = await readSessakuPieceGeneration(tx, scope);
      expect(deleted).not.toBe(updated);
      await tx.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...a } });
      const recreated = await readSessakuPieceGeneration(tx, scope);
      expect(recreated).not.toBe(before);
      expect(recreated).not.toBe(deleted);
    });
  });

  it('includes source sets across seibans, but excludes orphan parents and empty selections', async () => {
    await fixture(async (tx, a, b) => {
      const sets = tx.productionScheduleSessakuPieceSet;
      const parent = await sets.findUniqueOrThrow({ where: { csvDashboardId_fseiban_fhincd_fsigencd_fkojun: { csvDashboardId: dashboardId, ...a } } });
      const sourceSet = await sets.findUniqueOrThrow({ where: { csvDashboardId_fseiban_fhincd_fsigencd_fkojun: { csvDashboardId: dashboardId, ...b } } });
      const pieceSourceSet = await sets.create({ data: { csvDashboardId: dashboardId, ...b, fkojun: '2' } });
      const source = await tx.productionScheduleSessakuPiece.create({ data: { pieceSetId: pieceSourceSet.id, position: 1, quantity: 1 } });
      await sets.update({ where: { id: parent.id }, data: { sourcePieceSetId: sourceSet.id } });
      await tx.productionScheduleSessakuPiece.create({ data: { pieceSetId: parent.id, position: 1, quantity: 1, sourcePieceId: source.id } });
      const scope = { fseibans: [a.fseiban] };
      let previous = await readSessakuPieceGeneration(tx, scope);
      const empty = await readSessakuPieceGeneration(tx, { fseibans: [] });
      for (const id of [sourceSet.id, pieceSourceSet.id]) {
        await sets.update({ where: { id }, data: { version: { increment: 1 } } });
        const next = await readSessakuPieceGeneration(tx, scope);
        expect(next).not.toBe(previous);
        previous = next;
      }
      await sets.create({ data: { csvDashboardId: dashboardId, ...a, fkojun: 'orphan' } });
      expect(await readSessakuPieceGeneration(tx, scope)).toBe(previous);
      expect(await readSessakuPieceGeneration(tx, { fseibans: [] })).toBe(empty);
    });
  });
});
