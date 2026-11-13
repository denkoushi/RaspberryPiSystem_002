import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { createPrismaClient } from '../../../../lib/prisma-client.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID as dashboardId } from '../../constants.js';
import { replaceAllWinnerExternalCompletionStatesFromMailSync } from '../fkojunst-external-completion-sync.repository.js';

const { url, hasDedicatedDatabase } = vi.hoisted(() => {
  const workerId = process.env.VITEST_POOL_ID;
  const workerDatabase = process.env.CI === 'true' && process.env.API_TEST_DB_PER_WORKER === '1'
    && /^[1-9]\d*$/.test(workerId ?? '') && process.env.DATABASE_URL
    && new URL(process.env.DATABASE_URL).pathname === `/borrow_return_w${workerId}`;
  const url = process.env.TEST_DATABASE_URL ?? (workerDatabase ? process.env.DATABASE_URL : undefined);
  const hasDedicatedDatabase = Boolean(url) && !['/borrow_return', '/postgres', '/template1'].includes(new URL(url!).pathname);
  return { url, hasDedicatedDatabase };
});
const describeDatabase = hasDedicatedDatabase ? describe : describe.skip;
const client = hasDedicatedDatabase ? createPrismaClient(url) : undefined;

type Fixture = { tx: Prisma.TransactionClient; prefix: string; addRow: (fseiban: string, productNo?: string) => Promise<string> };

// Roll back everything so the shared per-worker database keeps no fixture rows.
async function fixture(run: (f: Fixture) => Promise<void>) {
  const rollback = new Error('rollback external completion fixture');
  try {
    await client!.$transaction(async (tx) => {
      await tx.csvDashboard.upsert({ where: { id: dashboardId }, create: { id: dashboardId, name: 'external-completion', columnDefinitions: [], templateConfig: {} }, update: {} });
      const prefix = `ext-${randomUUID()}`;
      const addRow = async (fseiban: string, productNo = '1') => {
        const row = await tx.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, occurredAt: new Date(), dataHash: `${fseiban}-${productNo}`,
          rowData: { FSEIBAN: fseiban, FHINCD: 'P', FSIGENCD: '021', FKOJUN: '10', ProductNo: productNo } } });
        return row.id;
      };
      await run({ tx, prefix, addRow });
      throw rollback;
    }, { timeout: 60_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function setMailStatus(tx: Prisma.TransactionClient, rowId: string, statusCode: string) {
  await tx.productionScheduleFkojunstMailStatus.upsert({
    where: { csvDashboardRowId: rowId },
    create: { csvDashboardId: dashboardId, csvDashboardRowId: rowId, sourceCsvDashboardId: dashboardId, fkojun: '10', fkoteicd: 'R01', fsezono: rowId.slice(0, 30), statusCode, sourceUpdatedAt: new Date() },
    update: { statusCode },
  });
}

const readExternal = (tx: Prisma.TransactionClient, rowId: string) =>
  tx.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: rowId } });

describeDatabase('replaceAllWinnerExternalCompletionStatesFromMailSync', () => {
  afterAll(async () => { await client?.$disconnect(); });

  it('rewrites only winners whose completion flags change', async () => {
    await fixture(async ({ tx, prefix, addRow }) => {
      const open = await addRow(`${prefix}-open`);
      const done = await addRow(`${prefix}-done`);
      await setMailStatus(tx, done, 'C');

      // First run inserts the fixture winners (and settles any other rows in this database).
      expect(await replaceAllWinnerExternalCompletionStatesFromMailSync(tx)).toBeGreaterThanOrEqual(2);
      expect(await readExternal(tx, open)).toMatchObject({ isExternallyCompleted: false, externallyCompletedFromFkojunstMailStatus: false });
      expect(await readExternal(tx, done)).toMatchObject({ isExternallyCompleted: true, externallyCompletedFromFkojunstMailStatus: true });

      // Nothing changed: no row is written again.
      expect(await replaceAllWinnerExternalCompletionStatesFromMailSync(tx)).toBe(0);

      // A status change rewrites exactly that winner.
      await setMailStatus(tx, open, 'X');
      expect(await replaceAllWinnerExternalCompletionStatesFromMailSync(tx)).toBe(1);
      expect(await readExternal(tx, open)).toMatchObject({ isExternallyCompleted: true, externallyCompletedFromFkojunstMailStatus: true });

      // A new winner without a status is inserted as not completed.
      const added = await addRow(`${prefix}-added`);
      expect(await replaceAllWinnerExternalCompletionStatesFromMailSync(tx)).toBe(1);
      expect(await readExternal(tx, added)).toMatchObject({ isExternallyCompleted: false });

      // Legacy disappearance flags still converge to false.
      await tx.productionScheduleExternalCompletion.update({ where: { csvDashboardRowId: done }, data: { externallyCompletedFromFkojunstDisappeared: true, externallyCompletedFromScheduleCsvDisappeared: true } });
      expect(await replaceAllWinnerExternalCompletionStatesFromMailSync(tx)).toBe(1);
      expect(await readExternal(tx, done)).toMatchObject({ isExternallyCompleted: true, externallyCompletedFromFkojunstDisappeared: false, externallyCompletedFromScheduleCsvDisappeared: false });

      // A flag edited out of band is corrected back to the mail status.
      await tx.productionScheduleExternalCompletion.update({ where: { csvDashboardRowId: added }, data: { isExternallyCompleted: true } });
      expect(await replaceAllWinnerExternalCompletionStatesFromMailSync(tx)).toBe(1);
      expect(await readExternal(tx, added)).toMatchObject({ isExternallyCompleted: false });

      expect(await replaceAllWinnerExternalCompletionStatesFromMailSync(tx)).toBe(0);
    });
  });
});
