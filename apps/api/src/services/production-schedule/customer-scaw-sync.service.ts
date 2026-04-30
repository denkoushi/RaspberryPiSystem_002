import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID } from './constants.js';
import {
  buildFankenmeiToCustomerLastWins,
  buildFseibanToCustomerFromProductionRows,
  loadCustomerScawSourceRowsFromIngest,
  loadMhShWinnerRowsForCustomerScaw,
  mapToCreateInputs,
  runCustomerScawClearTransaction,
  runCustomerScawReplacementTransaction,
  type CustomerScawSyncResult,
} from './customer-scaw-sync.pipeline.js';

export type ProductionScheduleCustomerScawSyncResult = CustomerScawSyncResult;

export class ProductionScheduleCustomerScawSyncService {
  async syncFromCustomerScawDashboard(params: { ingestRunId: string }): Promise<CustomerScawSyncResult> {
    const { scanned, orderedRows } = await loadCustomerScawSourceRowsFromIngest(prisma, params.ingestRunId);

    if (orderedRows.length === 0) {
      const result = await runCustomerScawClearTransaction(prisma, {
        csvRowsScanned: scanned,
        fankenmeiKeys: 0,
        productionRowsScanned: 0,
        matchedFseibans: 0,
      });
      logger.info(result, '[ProductionScheduleCustomerScawSyncService] CustomerSCAW sync cleared (no csv rows in ingest)');
      return result;
    }

    const fankenmeiToCustomer = buildFankenmeiToCustomerLastWins(orderedRows);
    const productionRows = await loadMhShWinnerRowsForCustomerScaw(prisma);
    const fseibanToCustomer = buildFseibanToCustomerFromProductionRows(productionRows, fankenmeiToCustomer);

    const createInputs = mapToCreateInputs(fseibanToCustomer, PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID);

    const result = await runCustomerScawReplacementTransaction(prisma, {
      resultMeta: {
        csvRowsScanned: scanned,
        fankenmeiKeys: fankenmeiToCustomer.size,
        productionRowsScanned: productionRows.length,
        matchedFseibans: fseibanToCustomer.size,
      },
      createInputs,
    });

    logger.info(result, '[ProductionScheduleCustomerScawSyncService] CustomerSCAW sync completed');
    return result;
  }
}
