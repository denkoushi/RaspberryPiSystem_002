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

    const result: RiggingInspectionSyncResult = emptyRiggingInspectionSyncResult(scanned);

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
          { managementNumber, idNum, inspectorName, ingestRunId: params.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: rigging gear not found'
        );
        continue;
      }

      const employee = await this.employeeResolver.findByDisplayName(inspectorName);
      if (!employee) {
        result.unmatchedEmployee += 1;
        logger.warn(
          { managementNumber: gear.managementNumber, inspectorName, ingestRunId: params.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: employee not found'
        );
        continue;
      }

      const mappedResult = mapRiggingInspectionResult(resultRaw);
      if (!mappedResult.ok) {
        result.invalidResult += 1;
        logger.warn(
          { result: resultRaw, managementNumber: gear.managementNumber, ingestRunId: params.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: invalid inspection result'
        );
        continue;
      }

      if (!inspectedAtRaw) {
        result.invalidDate += 1;
        logger.warn(
          { managementNumber: gear.managementNumber, ingestRunId: params.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: missing inspectedAt'
        );
        continue;
      }

      const inspectedAt = parseCsvDashboardDateColumnToUtc(inspectedAtRaw);
      if (!inspectedAt) {
        result.invalidDate += 1;
        logger.warn(
          { inspectedAtRaw, managementNumber: gear.managementNumber, ingestRunId: params.ingestRunId },
          '[RiggingInspectionProjectionService] Skipped row: invalid inspectedAt'
        );
        continue;
      }

      const isDuplicate = await this.dedupPolicy.existsForBusinessDay({
        riggingGearId: gear.id,
        employeeId: employee.id,
        inspectedAt,
      });
      if (isDuplicate) {
        result.deduped += 1;
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

    logger.info(
      { ingestRunId: params.ingestRunId, result },
      '[RiggingInspectionProjectionService] Rigging inspection sync completed'
    );
    return result;
  }
}
