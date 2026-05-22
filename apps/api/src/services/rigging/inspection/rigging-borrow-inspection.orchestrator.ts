import type { InspectionResult } from '@prisma/client';

import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { RiggingInspectionRecordService } from '../rigging-inspection-record.service.js';
import { RiggingInspectionDedupPolicy } from './rigging-inspection-dedup.policy.js';

export type RiggingBorrowInspectionInput = {
  riggingGearId: string;
  employeeId: string;
  loanId: string;
  managementNumber: string;
  inspectorName: string;
  inspectedAt: Date;
  result?: InspectionResult;
  notes?: string | null;
};

export class RiggingBorrowInspectionOrchestrator {
  private inspectionService = new RiggingInspectionRecordService();
  private dedupPolicy = new RiggingInspectionDedupPolicy(prisma);

  async recordIfNotDuplicate(input: RiggingBorrowInspectionInput): Promise<'created' | 'deduped' | 'skipped'> {
    try {
      const isDuplicate = await this.dedupPolicy.existsForBusinessDay({
        riggingGearId: input.riggingGearId,
        employeeId: input.employeeId,
        inspectedAt: input.inspectedAt,
      });
      if (isDuplicate) {
        return 'deduped';
      }

      await this.inspectionService.create({
        riggingGearId: input.riggingGearId,
        loanId: input.loanId,
        employeeId: input.employeeId,
        result: input.result ?? 'PASS',
        inspectedAt: input.inspectedAt,
        notes: input.notes ?? null,
      });
      return 'created';
    } catch (error) {
      logger.warn(
        {
          err: error,
          riggingGearId: input.riggingGearId,
          employeeId: input.employeeId,
          loanId: input.loanId,
          managementNumber: input.managementNumber,
        },
        '[RiggingBorrowInspectionOrchestrator] Failed to record kiosk inspection'
      );
      return 'skipped';
    }
  }
}
