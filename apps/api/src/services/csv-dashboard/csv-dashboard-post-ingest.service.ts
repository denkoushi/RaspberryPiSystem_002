import { logger } from '../../lib/logger.js';
import {
  PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from '../production-schedule/constants.js';
import { FkojunstExternalCompletionSyncService } from '../production-schedule/external-completion/fkojunst-external-completion-sync.service.js';
import { ProductionScheduleFkojunstSyncService } from '../production-schedule/fkojunst-sync.service.js';
import { ProductionScheduleFkojunstMailStatusSyncService } from '../production-schedule/fkojunst-status-mail-sync.service.js';
import { ProductionScheduleOrderSupplementSyncService } from '../production-schedule/order-supplement-sync.service.js';
import { ProductionScheduleCustomerScawSyncService } from '../production-schedule/customer-scaw-sync.service.js';
import { ProductionScheduleSeibanMachineNameSupplementSyncService } from '../production-schedule/seiban-machine-name-supplement-sync.service.js';
import type { OrderSupplementSyncResult } from '../production-schedule/order-supplement-sync.pipeline.js';
import type { FkojunstSyncResult } from '../production-schedule/fkojunst-sync.pipeline.js';
import type { FkojunstMailSyncResult } from '../production-schedule/fkojunst-status-mail-sync.pipeline.js';
import type { CustomerScawSyncResult } from '../production-schedule/customer-scaw-sync.pipeline.js';
import type { SeibanMachineNameSupplementSyncResult } from '../production-schedule/seiban-machine-name-supplement-sync.pipeline.js';
import { resetMachineNameFseibanMatchCaches } from '../production-schedule/machine-name-fseiban-match.service.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../part-measurement/self-inspection-machine-board-cache-invalidation.js';
import {
  PurchaseOrderLookupSyncService,
  type PurchaseOrderLookupSyncResult,
} from '../purchase-order-lookup/purchase-order-lookup-sync.service.js';
import { RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID } from '../rigging/constants.js';
import {
  RiggingInspectionProjectionService,
} from '../rigging/inspection/rigging-inspection-projection.service.js';
import type { RiggingInspectionSyncResult } from '../rigging/inspection/rigging-inspection-sync.pipeline.js';

export type CsvDashboardIngestSource = 'gmail' | 'manual';

export type CsvDashboardPostIngestResult = {
  orderSupplementSync: OrderSupplementSyncResult | null;
  fkojunstSync: FkojunstSyncResult | null;
  fkojunstMailSync: FkojunstMailSyncResult | null;
  seibanMachineNameSupplementSync: SeibanMachineNameSupplementSyncResult | null;
  customerScawSync: CustomerScawSyncResult | null;
  purchaseOrderLookupSync: PurchaseOrderLookupSyncResult | null;
  riggingInspectionSync: RiggingInspectionSyncResult | null;
};

/**
 * Runs CSV dashboard side-effects that must occur after a successful ingest,
 * for both Gmail and manual upload paths (single place to extend).
 */
export class CsvDashboardPostIngestService {
  constructor(
    private readonly orderSupplementSyncService: ProductionScheduleOrderSupplementSyncService = new ProductionScheduleOrderSupplementSyncService(),
    private readonly fkojunstSyncService: ProductionScheduleFkojunstSyncService = new ProductionScheduleFkojunstSyncService(),
    private readonly fkojunstMailStatusSyncService: ProductionScheduleFkojunstMailStatusSyncService = new ProductionScheduleFkojunstMailStatusSyncService(),
    private readonly externalCompletionSyncService: FkojunstExternalCompletionSyncService = new FkojunstExternalCompletionSyncService(),
    private readonly seibanMachineNameSupplementSyncService: ProductionScheduleSeibanMachineNameSupplementSyncService = new ProductionScheduleSeibanMachineNameSupplementSyncService(),
    private readonly customerScawSyncService: ProductionScheduleCustomerScawSyncService = new ProductionScheduleCustomerScawSyncService(),
    private readonly purchaseOrderLookupSyncService: PurchaseOrderLookupSyncService = new PurchaseOrderLookupSyncService(),
    private readonly riggingInspectionProjectionService: RiggingInspectionProjectionService = new RiggingInspectionProjectionService()
  ) {}

  async runAfterSuccessfulIngest(params: {
    dashboardId: string;
    ingestSource: CsvDashboardIngestSource;
    ingestRunId?: string;
  }): Promise<CsvDashboardPostIngestResult> {
    let orderSupplementSync: OrderSupplementSyncResult | null = null;
    let fkojunstSync: FkojunstSyncResult | null = null;
    let fkojunstMailSync: FkojunstMailSyncResult | null = null;
    let seibanMachineNameSupplementSync: SeibanMachineNameSupplementSyncResult | null = null;
    let customerScawSync: CustomerScawSyncResult | null = null;
    let purchaseOrderLookupSync: PurchaseOrderLookupSyncResult | null = null;
    let riggingInspectionSync: RiggingInspectionSyncResult | null = null;

    if (params.dashboardId === PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID) {
      orderSupplementSync = await this.orderSupplementSyncService.syncFromSupplementDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: orderSupplementSync },
        '[CsvDashboardPostIngestService] Production schedule order supplement sync completed'
      );
      resetSelfInspectionMachineBoardScheduleRowCaches();
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID) {
      fkojunstSync = await this.fkojunstSyncService.syncFromFkojunstDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: fkojunstSync },
        '[CsvDashboardPostIngestService] FKOJUNST status sync completed'
      );
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID) {
      fkojunstMailSync = await this.fkojunstMailStatusSyncService.syncFromStatusMailDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: fkojunstMailSync },
        '[CsvDashboardPostIngestService] FKOJUNST_Status mail sync completed'
      );
      resetSelfInspectionMachineBoardScheduleRowCaches();
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_DASHBOARD_ID) {
      const externalCompletionSync = await this.externalCompletionSyncService.syncFromCurrentStatusMailDashboard();
      logger.info(
        { dashboardId: params.dashboardId, ingestSource: params.ingestSource, syncResult: externalCompletionSync },
        '[CsvDashboardPostIngestService] external completion sync completed after production schedule ingest'
      );
      resetMachineNameFseibanMatchCaches();
      resetSelfInspectionMachineBoardScheduleRowCaches();
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID) {
      if (!params.ingestRunId) {
        throw new Error('[CsvDashboardPostIngestService] ingestRunId is required for seiban machine name supplement sync');
      }
      seibanMachineNameSupplementSync = await this.seibanMachineNameSupplementSyncService.syncFromSupplementDashboard({
        ingestRunId: params.ingestRunId,
      });
      logger.info(
        {
          dashboardId: params.dashboardId,
          ingestSource: params.ingestSource,
          ingestRunId: params.ingestRunId,
          syncResult: seibanMachineNameSupplementSync,
        },
        '[CsvDashboardPostIngestService] Seiban machine name supplement sync completed'
      );
      resetMachineNameFseibanMatchCaches();
      resetSelfInspectionMachineBoardScheduleRowCaches();
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID) {
      if (!params.ingestRunId) {
        throw new Error('[CsvDashboardPostIngestService] ingestRunId is required for CustomerSCAW sync');
      }
      customerScawSync = await this.customerScawSyncService.syncFromCustomerScawDashboard({
        ingestRunId: params.ingestRunId,
      });
      logger.info(
        {
          dashboardId: params.dashboardId,
          ingestSource: params.ingestSource,
          ingestRunId: params.ingestRunId,
          syncResult: customerScawSync,
        },
        '[CsvDashboardPostIngestService] CustomerSCAW sync completed'
      );
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID) {
      if (!params.ingestRunId) {
        throw new Error('[CsvDashboardPostIngestService] ingestRunId is required for FKOBAINO purchase order lookup sync');
      }
      purchaseOrderLookupSync = await this.purchaseOrderLookupSyncService.syncFromFkobainoDashboard({
        ingestRunId: params.ingestRunId,
      });
      logger.info(
        {
          dashboardId: params.dashboardId,
          ingestSource: params.ingestSource,
          ingestRunId: params.ingestRunId,
          syncResult: purchaseOrderLookupSync,
        },
        '[CsvDashboardPostIngestService] FKOBAINO purchase order lookup sync completed'
      );
    }

    if (params.dashboardId === RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID) {
      if (!params.ingestRunId) {
        throw new Error('[CsvDashboardPostIngestService] ingestRunId is required for rigging inspection sync');
      }
      riggingInspectionSync = await this.riggingInspectionProjectionService.syncFromIngestRun({
        ingestRunId: params.ingestRunId,
      });
      logger.info(
        {
          dashboardId: params.dashboardId,
          ingestSource: params.ingestSource,
          ingestRunId: params.ingestRunId,
          syncResult: riggingInspectionSync,
        },
        '[CsvDashboardPostIngestService] Rigging inspection sync completed'
      );
    }

    if (
      orderSupplementSync === null &&
      fkojunstSync === null &&
      fkojunstMailSync === null &&
      seibanMachineNameSupplementSync === null &&
      customerScawSync === null &&
      purchaseOrderLookupSync === null &&
      riggingInspectionSync === null
    ) {
      return {
        orderSupplementSync: null,
        fkojunstSync: null,
        fkojunstMailSync: null,
        seibanMachineNameSupplementSync: null,
        customerScawSync: null,
        purchaseOrderLookupSync: null,
        riggingInspectionSync: null,
      };
    }

    return {
      orderSupplementSync,
      fkojunstSync,
      fkojunstMailSync,
      seibanMachineNameSupplementSync,
      customerScawSync,
      purchaseOrderLookupSync,
      riggingInspectionSync,
    };
  }
}
