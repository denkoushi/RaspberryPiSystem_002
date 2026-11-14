import { APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS, CsvDashboardAppendRawRowPruneService } from './csv-dashboard-append-raw-row-prune.service.js';
import { pruneCompletedGrindingPlanningBoardSeibans } from '../production-schedule/grinding-planning-board/completion.js';
import { markProductionScheduleResourceCdsCacheStale } from '../production-schedule/production-schedule-query/resources.js';
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
import { SCAW_STFUTEKIGO_DASHBOARD_ID } from '../scaw-stfutekigo/constants.js';
import { ScawStfutekigoSyncService } from '../scaw-stfutekigo/sync.service.js';
import type { ScawStfutekigoSyncResult } from '../scaw-stfutekigo/types.js';

export type CsvDashboardIngestSource = 'gmail' | 'manual';

export type CsvDashboardPostIngestResult = {
  orderSupplementSync: OrderSupplementSyncResult | null;
  fkojunstSync: FkojunstSyncResult | null;
  fkojunstMailSync: FkojunstMailSyncResult | null;
  seibanMachineNameSupplementSync: SeibanMachineNameSupplementSyncResult | null;
  customerScawSync: CustomerScawSyncResult | null;
  purchaseOrderLookupSync: PurchaseOrderLookupSyncResult | null;
  riggingInspectionSync: RiggingInspectionSyncResult | null;
  scawStfutekigoSync: ScawStfutekigoSyncResult | null;
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
    private readonly riggingInspectionProjectionService: RiggingInspectionProjectionService = new RiggingInspectionProjectionService(),
    private readonly scawStfutekigoSyncService: ScawStfutekigoSyncService = new ScawStfutekigoSyncService(),
    private readonly appendRawRowPruneService: CsvDashboardAppendRawRowPruneService = new CsvDashboardAppendRawRowPruneService()
  ) {}

  private static readonly appendRawRowPruneInFlight = new Set<string>();

  private async runAppendRawRowPrune(dashboardId: string): Promise<void> {
    if (CsvDashboardPostIngestService.appendRawRowPruneInFlight.has(dashboardId)) {
      logger.info({ dashboardId }, '[CsvDashboardPostIngestService] append raw row prune skipped: already running');
      return;
    }
    CsvDashboardPostIngestService.appendRawRowPruneInFlight.add(dashboardId);
    let pruneResult: { deletedCount: number; hasRemaining: boolean | null } = { deletedCount: 0, hasRemaining: null };
    try {
      pruneResult = await this.appendRawRowPruneService.prune(dashboardId);
    } catch (error) {
      logger.error({ err: error, dashboardId }, '[CsvDashboardPostIngestService] append raw row prune failed');
    } finally {
      CsvDashboardPostIngestService.appendRawRowPruneInFlight.delete(dashboardId);
    }
    logger.info({ dashboardId, ...pruneResult }, '[CsvDashboardPostIngestService] append raw row prune completed');
  }

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
    let scawStfutekigoSync: ScawStfutekigoSyncResult | null = null;

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
      markProductionScheduleResourceCdsCacheStale();
      const externalCompletionSync = await this.externalCompletionSyncService.syncFromCurrentStatusMailDashboard();
      try {
        await pruneCompletedGrindingPlanningBoardSeibans();
      } catch (error) {
        // Pruning is housekeeping; it must not fail the schedule ingest.
        logger.error({ err: error, dashboardId: params.dashboardId }, '[CsvDashboardPostIngestService] planning board completion prune failed');
      }
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

    if (params.dashboardId === SCAW_STFUTEKIGO_DASHBOARD_ID) {
      if (!params.ingestRunId) {
        throw new Error('[CsvDashboardPostIngestService] ingestRunId is required for scawSTFUTEKIGO sync');
      }
      scawStfutekigoSync = await this.scawStfutekigoSyncService.syncFromScawStfutekigoDashboard({
        ingestRunId: params.ingestRunId,
      });
      logger.info(
        {
          dashboardId: params.dashboardId,
          ingestSource: params.ingestSource,
          ingestRunId: params.ingestRunId,
          syncResult: scawStfutekigoSync,
        },
        '[CsvDashboardPostIngestService] scawSTFUTEKIGO sync completed'
      );
    }

    if ((APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS as readonly string[]).includes(params.dashboardId)) {
      // Housekeeping can take minutes (1,000-row batches with pauses); do not hold the upload response or ingest scheduler.
      void this.runAppendRawRowPrune(params.dashboardId);
    }

    if (
      orderSupplementSync === null &&
      fkojunstSync === null &&
      fkojunstMailSync === null &&
      seibanMachineNameSupplementSync === null &&
      customerScawSync === null &&
      purchaseOrderLookupSync === null &&
      riggingInspectionSync === null &&
      scawStfutekigoSync === null
    ) {
      return {
        orderSupplementSync: null,
        fkojunstSync: null,
        fkojunstMailSync: null,
        seibanMachineNameSupplementSync: null,
        customerScawSync: null,
        purchaseOrderLookupSync: null,
        riggingInspectionSync: null,
        scawStfutekigoSync: null,
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
      scawStfutekigoSync,
    };
  }
}
