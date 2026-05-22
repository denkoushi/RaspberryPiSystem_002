import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { parseCsvDashboardDateColumnToUtc } from '../../csv-dashboard/csv-dashboard-datetime-parse.js';
import { RiggingInspectionRecordService } from '../rigging-inspection-record.service.js';
import { EmployeeDisplayNameResolver } from './employee-display-name-resolver.js';
import { RiggingGearResolver } from './rigging-gear-resolver.js';
import { RiggingInspectionDedupPolicy } from './rigging-inspection-dedup.policy.js';
import { mapRiggingInspectionResult } from './rigging-inspection-result-mapper.js';
import {
  emptyRiggingInspectionSyncResult,
  loadRiggingInspectionSourceRowsFromDashboard,
  loadRiggingInspectionSourceRowsFromIngest,
  type RiggingInspectionSyncResult,
} from './rigging-inspection-sync.pipeline.js';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildGmailNotes(rowData: Record<string, unknown>): string {
  return JSON.stringify({
    source: 'gmail',
    itemName: asString(rowData.itemName),
    locationName: asString(rowData.locationName),
    locationNo: asString(rowData.locationNo),
  });
}

type ProjectionContext = {
  ingestRunId?: string;
};

export class RiggingInspectionProjectionService {
  private gearResolver = new RiggingGearResolver(prisma);
  private employeeResolver = new EmployeeDisplayNameResolver(prisma);
  private dedupPolicy = new RiggingInspectionDedupPolicy(prisma);
  private inspectionService = new RiggingInspectionRecordService();

  async syncFromIngestRun(params: { ingestRunId: string }): Promise<RiggingInspectionSyncResult> {
    const { scanned, orderedRows } = await loadRiggingInspectionSourceRowsFromIngest(prisma, params.ingestRunId);
    if (orderedRows.length === 0) {
      return emptyRiggingInspectionSyncResult(scanned);
    }

    const result = await this.projectOrderedRows(orderedRows, { ingestRunId: params.ingestRunId });
    logger.info(
      { ingestRunId: params.ingestRunId, result },
      '[RiggingInspectionProjectionService] Rigging inspection sync completed'
    );
    return { ...result, csvRowsScanned: scanned };
  }

  async syncFromPersistedDashboardRows(): Promise<RiggingInspectionSyncResult> {
    const { scanned, orderedRows } = await loadRiggingInspectionSourceRowsFromDashboard(prisma);
    if (orderedRows.length === 0) {
      return emptyRiggingInspectionSyncResult(scanned);
    }

    const result = await this.projectOrderedRows(orderedRows, {});
    logger.info(
      { result },
      '[RiggingInspectionProjectionService] Rigging inspection persisted dashboard sync completed'
    );
    return { ...result, csvRowsScanned: scanned };
  }

  private async projectOrderedRows(
    orderedRows: Array<{ rowData: Record<string, unknown> }>,
    context: ProjectionContext
  ): Promise<RiggingInspectionSyncResult> {
    const result: RiggingInspectionSyncResult = emptyRiggingInspectionSyncResult(orderedRows.length);

    for (const { rowData } of orderedRows) {
      const managementNumber = asString(rowData.managementNumber);
      const idNum = asString(rowData.idNum);
      const inspectorName = asString(rowData.inspectorName);
      const resultRaw = rowData.result;
      const inspectedAtRaw = asString(rowData.inspectedAt);

      const gear = await this.gearResolver.resolve({ managementNumber, idNum });
      if (!gear) {
        result.unmatchedGear += 1;
        logger.warn(
          { managementNumber, idNum, inspectorName, ingestRunId: context.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: rigging gear not found'
        );
        continue;
      }

      const employee = await this.employeeResolver.findByDisplayName(inspectorName);
      if (!employee) {
        result.unmatchedEmployee += 1;
        logger.warn(
          { managementNumber: gear.managementNumber, inspectorName, ingestRunId: context.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: employee not found'
        );
        continue;
      }

      const mappedResult = mapRiggingInspectionResult(resultRaw);
      if (!mappedResult.ok) {
        result.invalidResult += 1;
        logger.warn(
          { result: resultRaw, managementNumber: gear.managementNumber, ingestRunId: context.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: invalid inspection result'
        );
        continue;
      }

      if (!inspectedAtRaw) {
        result.invalidDate += 1;
        logger.warn(
          { managementNumber: gear.managementNumber, ingestRunId: context.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: missing inspectedAt'
        );
        continue;
      }

      const inspectedAt = parseCsvDashboardDateColumnToUtc(inspectedAtRaw);
      if (!inspectedAt) {
        result.invalidDate += 1;
        logger.warn(
          { inspectedAtRaw, managementNumber: gear.managementNumber, ingestRunId: context.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: invalid inspectedAt'
        );
        continue;
      }

      const existing = await this.dedupPolicy.findForBusinessDay({
        riggingGearId: gear.id,
        employeeId: employee.id,
        inspectedAt,
      });
      if (existing) {
        if (inspectedAt.getTime() > existing.inspectedAt.getTime()) {
          await prisma.riggingInspectionRecord.update({
            where: { id: existing.id },
            data: {
              inspectedAt,
              result: mappedResult.result,
              notes: buildGmailNotes(rowData),
            },
          });
          result.refreshed += 1;
        } else {
          result.deduped += 1;
        }
        continue;
      }

      await this.inspectionService.create({
        riggingGearId: gear.id,
        employeeId: employee.id,
        result: mappedResult.result,
        inspectedAt,
        notes: buildGmailNotes(rowData),
      });
      result.created += 1;
    }

    return result;
  }
}
