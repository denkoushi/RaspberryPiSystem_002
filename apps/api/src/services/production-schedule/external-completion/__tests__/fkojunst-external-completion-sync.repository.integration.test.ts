import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { createPrismaClient } from '../../../../lib/prisma-client.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID as dashboardId,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID as mailDashboardId,
} from '../../constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../../fkojunst-status-mail-critical-lock.js';
import { dedupeFkojunstMailRowsByLatest, replaceFkojunstMailProjections, toFkojunstMailNormalizedRow } from '../../fkojunst-status-mail-sync.pipeline.js';
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

type Fixture = { tx: Prisma.TransactionClient; prefix: string; addRow: (fseiban: string, productNo?: string, resourceCd?: string) => Promise<string> };

// Roll back everything so the shared per-worker database keeps no fixture rows.
async function fixture(run: (f: Fixture) => Promise<void>) {
  const rollback = new Error('rollback external completion fixture');
  try {
    await client!.$transaction(async (tx) => {
      await tx.csvDashboard.upsert({ where: { id: dashboardId }, create: { id: dashboardId, name: 'external-completion', columnDefinitions: [], templateConfig: {} }, update: {} });
      const prefix = `ext-${randomUUID()}`;
      const addRow = async (fseiban: string, productNo = '1', resourceCd = '021') => {
        const row = await tx.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, occurredAt: new Date(), dataHash: `${fseiban}-${productNo}`,
          rowData: { FSEIBAN: fseiban, FHINCD: 'P', FSIGENCD: resourceCd, FKOJUN: '10', ProductNo: productNo } } });
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

  it('publishes and revokes swap completion, reclassifying evidence when the schedule changes', async () => {
    await fixture(async ({ tx, prefix, addRow }) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      const resourceCategoryKey = { csvDashboardId: dashboardId, location: 'shared' };
      const cuttingExcludedResourceCds = ['10', 'KUMITATE1', 'KUMITATE2', 'MSZ'];
      await tx.productionScheduleResourceCategoryConfig.upsert({
        where: { csvDashboardId_location: resourceCategoryKey },
        create: { ...resourceCategoryKey, cuttingExcludedResourceCds },
        update: { cuttingExcludedResourceCds },
      });

      const productNo = prefix.slice(-12);
      const assemblyNo = `${productNo}-assembly`;
      const multipleWinnersNo = `${productNo}-multiple`;
      const ambiguousNo = `${productNo}-ambiguous`;
      const scheduleChangeNo = `${productNo}-change`;
      const excludedSiblingNo = `${productNo}-sibling`;
      const swap = await addRow(prefix, productNo);
      const assembly = await addRow(`${prefix}-assembly`, assemblyNo, 'KUMITATE1');
      const multipleWinners = await addRow(`${prefix}-multiple1`, multipleWinnersNo);
      await addRow(`${prefix}-multiple2`, multipleWinnersNo, '052');
      const ambiguous = await addRow(`${prefix}-ambiguous`, ambiguousNo);
      const oldWinner = await addRow(`${prefix}-change`, scheduleChangeNo, '301');
      // 本番では同じ工順に資源 10 の行が並ぶことが多い。除外資源の行は winner の数に入れない。
      const withExcludedSibling = await addRow(`${prefix}-sibling1`, excludedSiblingNo);
      await addRow(`${prefix}-sibling2`, excludedSiblingNo, '10');
      // 自分の資源(021)の状態と、別資源の状態の組み合わせ。
      const caseNo = (name: string) => `${productNo}-${name}`;
      const ownStarted = await addRow(`${prefix}-own-s`, caseNo('own-s'));
      const ownNewer = await addRow(`${prefix}-own-newer`, caseNo('own-newer'));
      const ownOlderR = await addRow(`${prefix}-own-older-r`, caseNo('own-older-r'));
      const otherX = await addRow(`${prefix}-other-x`, caseNo('other-x'));
      const otherExcluded = await addRow(`${prefix}-other-excluded`, caseNo('other-excluded'));
      const status = (number: string, resourceCd: string, code: string, day = '25') =>
        toFkojunstMailNormalizedRow(`${number}-${resourceCd}-${day}`, {
          FSEZONO: number, FKOJUN: '10', FKOTEICD: resourceCd, FKOJUNST: code,
          FUPDTEDT: `2026-11-${day}T00:00:00Z`,
        }).row!;
      const rows = [
        status(productNo, '301', 'C'),
        status(assemblyNo, '301', 'C'),
        status(multipleWinnersNo, '301', 'C'),
        status(ambiguousNo, '301', 'C'),
        status(ambiguousNo, '041', 'P'),
        status(scheduleChangeNo, '301', 'C'),
        status(excludedSiblingNo, '301', 'C'),
        status(caseNo('own-s'), '021', 'S', '24'), status(caseNo('own-s'), '301', 'C'),
        status(caseNo('own-newer'), '021', 'R', '26'), status(caseNo('own-newer'), '301', 'C'),
        status(caseNo('own-older-r'), '021', 'R', '24'), status(caseNo('own-older-r'), '301', 'C'),
        status(caseNo('other-x'), '301', 'X'),
        status(caseNo('other-excluded'), '10', 'C'),
        // winner の無い工程は証拠に残さない。
        status(`${productNo}-nowinner`, '301', 'C'),
      ];
      expect(await replaceFkojunstMailProjections(tx, rows)).toMatchObject({ matched: 4, unmatched: 12 });
      expect(await tx.productionScheduleFkojunstResourceSwapEvidence.count({
        where: { sourceCsvDashboardId: mailDashboardId, productNo: `${productNo}-nowinner` },
      })).toBe(0);
      await replaceAllWinnerExternalCompletionStatesFromMailSync(tx, true);
      expect(await readExternal(tx, swap)).toMatchObject({
        isExternallyCompleted: true, externallyCompletedFromFkojunstMailStatus: false, externallyCompletedFromFkojunstResourceSwap: true,
      });
      for (const blocked of [assembly, multipleWinners, ambiguous]) {
        expect(await readExternal(tx, blocked)).toMatchObject({ isExternallyCompleted: false, externallyCompletedFromFkojunstResourceSwap: false });
      }
      expect(await readExternal(tx, oldWinner)).toMatchObject({
        isExternallyCompleted: true, externallyCompletedFromFkojunstMailStatus: true, externallyCompletedFromFkojunstResourceSwap: false,
      });
      expect(await readExternal(tx, withExcludedSibling)).toMatchObject({ isExternallyCompleted: true, externallyCompletedFromFkojunstResourceSwap: true });
      expect(await readExternal(tx, ownOlderR)).toMatchObject({ isExternallyCompleted: true, externallyCompletedFromFkojunstResourceSwap: true });
      for (const blocked of [ownStarted, ownNewer, otherX, otherExcluded]) {
        expect(await readExternal(tx, blocked)).toMatchObject({ isExternallyCompleted: false, externallyCompletedFromFkojunstResourceSwap: false });
      }
      expect(await replaceAllWinnerExternalCompletionStatesFromMailSync(tx, true)).toBe(0);

      const nextRows = dedupeFkojunstMailRowsByLatest([...rows, status(productNo, '301', 'P', '26')]);
      await replaceFkojunstMailProjections(tx, nextRows);
      await replaceAllWinnerExternalCompletionStatesFromMailSync(tx, true);
      expect(await readExternal(tx, swap)).toMatchObject({ isExternallyCompleted: false, externallyCompletedFromFkojunstResourceSwap: false });
      expect(await tx.productionScheduleFkojunstResourceSwapEvidence.findFirst({
        where: { sourceCsvDashboardId: mailDashboardId, productNo, fkojun: '10', resourceCd: '301' },
      })).toMatchObject({ statusCode: 'P' });

      await tx.csvDashboardRow.update({ where: { id: oldWinner }, data: { supersededAt: new Date() } });
      const replacement = await addRow(`${prefix}-replacement`, scheduleChangeNo);
      expect(await replaceFkojunstMailProjections(tx, nextRows, true)).toMatchObject({
        matched: 3, unmatched: 13, pruned: 1, prunedEvidence: 0,
      });
      await replaceAllWinnerExternalCompletionStatesFromMailSync(tx, true);
      expect(await readExternal(tx, replacement)).toMatchObject({
        isExternallyCompleted: true, externallyCompletedFromFkojunstMailStatus: false, externallyCompletedFromFkojunstResourceSwap: true,
      });
      expect(await replaceFkojunstMailProjections(tx, nextRows, true)).toMatchObject({
        upserted: 0, pruned: 0, prunedEvidence: 0,
      });
    });
  });
});
