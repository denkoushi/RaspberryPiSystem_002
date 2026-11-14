import { readMissingStandardHoursBoardRows } from '../missing-standard-hours-process.js';
import { Prisma } from '@prisma/client';

import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { getResourceCategoryPolicy } from '../policies/resource-category-policy.service.js';
import { readSessakuPieceSets } from '../sessaku-pieces/piece-key.js';
import { asRowData, isCategoryResource, valueAsString } from './shared.js';
import { readRowDetails, readWinnerRowsByFseibans } from './source.js';
import { lockState, stateOrder } from './state.js';
import { saveSeibanOrderInTransaction } from './write.js';

/** Called after schedule ingest and completion sync, never from a board read. */
export async function pruneCompletedGrindingPlanningBoardSeibans(): Promise<void> {
  const boards = await prisma.productionScheduleGrindingPlanningBoardState.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { siteKey: true, seibanOrder: true }
  });
  for (const board of boards) {
    try {
      await pruneBoard(board.siteKey, stateOrder(board));
    } catch (error) {
      // One failing site must not stop the other boards from being pruned.
      logger.error({ err: error, siteKey: board.siteKey }, '[pruneCompletedGrindingPlanningBoardSeibans] site prune failed');
    }
  }
}

async function findCompletedSeibans(siteKey: string, order: string[]): Promise<Set<string>> {
  if (order.length === 0) return new Set();
  const policy = await getResourceCategoryPolicy({ siteKey });
  // Heavy reads stay outside the locking transaction, like the order write path.
  const rows = await readWinnerRowsByFseibans(prisma, order);
  const details = await readRowDetails(prisma, rows.map((row) => row.id));
  const pieceSets = await readSessakuPieceSets(prisma, rows);
  // Match the board's process-part population; machine rows cannot prove completion.
  const parts = rows.filter((row) => !/^(MH|SH)/.test(valueAsString(asRowData(row.rowData), 'FHINCD').trim().toUpperCase()));
  const { allItems } = projectGrindingPlanningBoard({
    missingStandardHoursRows: await readMissingStandardHoursBoardRows(prisma),
    rows: parts, details, pieceSets, includePieces: true, ranks: { rows: new Map() }, overrides: new Map(),
    category: 'all', allocation: 'original', seibanOrder: order,
    isResourceInCategory: (resourceCd, category) => isCategoryResource(resourceCd, category, policy)
  });
  const complete = new Map<string, boolean>();
  for (const row of parts) {
    const data = asRowData(row.rowData);
    if (isCategoryResource(valueAsString(data, 'FSIGENCD'), 'all', policy) && !details.has(row.id)) complete.set(valueAsString(data, 'FSEIBAN'), false);
  }
  for (const item of allItems) complete.set(item.fseiban, (complete.get(item.fseiban) ?? true) && item.isCompleted);
  return new Set([...complete].filter(([, done]) => done).map(([fseiban]) => fseiban));
}

async function pruneBoard(siteKey: string, snapshotOrder: string[]): Promise<void> {
  const completed = await findCompletedSeibans(siteKey, snapshotOrder);
  if (completed.size === 0) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prisma.$transaction(async (client) => {
        const state = await lockState(client, siteKey);
        const order = stateOrder(state);
        // Seibans added after the snapshot were not judged, so they are never in `completed`.
        if (!order.some((fseiban) => completed.has(fseiban))) return;
        await saveSeibanOrderInTransaction(client, state, order.filter((fseiban) => !completed.has(fseiban)));
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 1) throw error;
    }
  }
}
