import { logger } from '../../lib/logger.js';
import { PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from '../production-schedule/constants.js';
import { ProductionScheduleOrderSupplementSyncService } from '../production-schedule/order-supplement-sync.service.js';
import type { OrderSupplementSyncResult } from '../production-schedule/order-supplement-sync.pipeline.js';

export type CsvDashboardIngestSource = 'gmail' | 'manual';

export type CsvDashboardPostIngestResult = {
  orderSupplementSync: OrderSupplementSyncResult | null;
};

/**
 * Runs CSV dashboard side-effects that must occur after a successful ingest,
 * for both Gmail and manual upload paths (single place to extend).
 */
export class CsvDashboardPostIngestService {
  constructor(
    private readonly orderSupplementSync: ProductionScheduleOrderSupplementSyncService = new ProductionScheduleOrderSupplementSyncService()
  ) {}

  async runAfterSuccessfulIngest(params: {
    dashboardId: string;
    ingestSource: CsvDashboardIngestSource;
  }): Promise<CsvDashboardPostIngestResult> {
    if (params.dashboardId !== PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID) {
      return { orderSupplementSync: null };
    }

    const syncResult = await this.orderSupplementSync.syncFromSupplementDashboard();
    logger.info(
      { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult },
      '[CsvDashboardPostIngestService] Production schedule order supplement sync completed'
    );
    return { orderSupplementSync: syncResult };
  }
}
