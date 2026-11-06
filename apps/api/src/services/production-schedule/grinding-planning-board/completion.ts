import { Prisma } from '@prisma/client';

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
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { siteKey: true }
  });
  for (const { siteKey } of boards) {
    const policy = await getResourceCategoryPolicy({ siteKey });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await prisma.$transaction(async (client) => {
          const state = await lockState(client, siteKey);
          const order = stateOrder(state);
          const rows = await readWinnerRowsByFseibans(client, order);
          const details = await readRowDetails(client, rows.map((row) => row.id));
          const pieceSets = await readSessakuPieceSets(client, rows);
          // Match the board's process-part population; machine rows cannot prove completion.
          const parts = rows.filter((row) => !/^(MH|SH)/.test(valueAsString(asRowData(row.rowData), 'FHINCD').trim().toUpperCase()));
          const { allItems } = projectGrindingPlanningBoard({
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
          await saveSeibanOrderInTransaction(client, state, order.filter((fseiban) => complete.get(fseiban) !== true));
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 1) throw error;
      }
    }
  }
}
