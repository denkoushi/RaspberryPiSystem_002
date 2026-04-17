import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from './constants.js';
import {
  buildLastWinsSeibanMachineNames,
  loadSeibanMachineNameSupplementSourceRows,
  mapToCreateInputs,
  runSeibanMachineNameSupplementClearTransaction,
  runSeibanMachineNameSupplementReplacementTransaction,
} from './seiban-machine-name-supplement-sync.pipeline.js';

export type ProductionScheduleSeibanMachineNameSupplementSyncResult =
  import('./seiban-machine-name-supplement-sync.pipeline.js').SeibanMachineNameSupplementSyncResult;

/**
 * Gmail 件名 `FHINMEI_MH_SH` の CsvDashboard 取り込み後に、製番→機種名補完テーブルを全置換する。
 */
export class ProductionScheduleSeibanMachineNameSupplementSyncService {
  async syncFromSupplementDashboard(params: {
    ingestRunId: string;
  }): Promise<ProductionScheduleSeibanMachineNameSupplementSyncResult> {
    const { scanned, orderedRows } = await loadSeibanMachineNameSupplementSourceRows(prisma, params.ingestRunId);

    if (orderedRows.length === 0) {
      const result = await runSeibanMachineNameSupplementClearTransaction(prisma, scanned);
      logger.info(
        result,
        '[ProductionScheduleSeibanMachineNameSupplementSyncService] Seiban machine name supplement sync cleared (no rows)'
      );
      return result;
    }

    const lastWins = buildLastWinsSeibanMachineNames(orderedRows);
    const createInputs = mapToCreateInputs(lastWins, PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID);

    const result = await runSeibanMachineNameSupplementReplacementTransaction(prisma, {
      scanned,
      createInputs,
    });

    logger.info(result, '[ProductionScheduleSeibanMachineNameSupplementSyncService] Seiban machine name supplement sync completed');
    return result;
  }
}
