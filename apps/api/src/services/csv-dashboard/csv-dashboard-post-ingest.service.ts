import { logger } from '../../lib/logger.js';
import {
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from '../production-schedule/constants.js';
import { ProductionScheduleFkojunstSyncService } from '../production-schedule/fkojunst-sync.service.js';
import { ProductionScheduleOrderSupplementSyncService } from '../production-schedule/order-supplement-sync.service.js';
import type { OrderSupplementSyncResult } from '../production-schedule/order-supplement-sync.pipeline.js';
import type { FkojunstSyncResult } from '../production-schedule/fkojunst-sync.pipeline.js';

export type CsvDashboardIngestSource = 'gmail' | 'manual';

export type CsvDashboardPostIngestResult = {
  orderSupplementSync: OrderSupplementSyncResult | null;
  fkojunstSync: FkojunstSyncResult | null;
};

/**
 * Runs CSV dashboard side-effects that must occur after a successful ingest,
 * for both Gmail and manual upload paths (single place to extend).
 */
export class CsvDashboardPostIngestService {
  constructor(
    private readonly orderSupplementSyncService: ProductionScheduleOrderSupplementSyncService = new ProductionScheduleOrderSupplementSyncService(),
    private readonly fkojunstSyncService: ProductionScheduleFkojunstSyncService = new ProductionScheduleFkojunstSyncService()
  ) {}

  async runAfterSuccessfulIngest(params: {
    dashboardId: string;
    ingestSource: CsvDashboardIngestSource;
  }): Promise<CsvDashboardPostIngestResult> {
    let orderSupplementSync: OrderSupplementSyncResult | null = null;
    let fkojunstSync: FkojunstSyncResult | null = null;

    if (params.dashboardId === PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID) {
      orderSupplementSync = await this.orderSupplementSyncService.syncFromSupplementDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: orderSupplementSync },
        '[CsvDashboardPostIngestService] Production schedule order supplement sync completed'
      );
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID) {
      fkojunstSync = await this.fkojunstSyncService.syncFromFkojunstDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: fkojunstSync },
        '[CsvDashboardPostIngestService] FKOJUNST status sync completed'
      );
    }

    if (orderSupplementSync === null && fkojunstSync === null) {
      return { orderSupplementSync: null, fkojunstSync: null };
    }

    return { orderSupplementSync, fkojunstSync };
  }
}
