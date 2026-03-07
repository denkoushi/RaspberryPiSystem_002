import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { resolveUpdatedAt } from '../csv-dashboard/diff/csv-dashboard-updated-at.js';
import { dueManagementLearningEventRepository } from './due-management-learning-event.repository.js';

type ProgressSyncCandidate = {
  rowId: string;
  rowData: Prisma.JsonValue;
  occurredAt: Date;
};

type SyncProgressFromCsvParams = {
  candidates: ProgressSyncCandidate[];
  locationKey?: string;
};

const normalizeProgress = (value: unknown): string => String(value ?? '').trim();

const toIsCompleted = (progress: string): boolean | null => {
  if (progress === COMPLETED_PROGRESS_VALUE) {
    return true;
  }
  if (progress === '') {
    return false;
  }
  return null;
};

export class ProgressSyncFromCsvService {
  async sync(params: SyncProgressFromCsvParams): Promise<void> {
    const { candidates } = params;
    if (candidates.length === 0) {
      return;
    }

    for (const candidate of candidates) {
      const rowData = candidate.rowData as Record<string, unknown> | null;
      const progress = normalizeProgress(rowData?.progress);
      const isCompleted = toIsCompleted(progress);
      if (isCompleted === null) {
        continue;
      }

      const csvUpdatedAt = resolveUpdatedAt(candidate.rowData, candidate.occurredAt);
      const existing = await prisma.productionScheduleProgress.findUnique({
        where: { csvDashboardRowId: candidate.rowId },
        select: { updatedAt: true, isCompleted: true },
      });

      // 同時刻は本システム側優先（CSVは上書きしない）
      if (existing && csvUpdatedAt.getTime() <= existing.updatedAt.getTime()) {
        continue;
      }

      await prisma.productionScheduleProgress.upsert({
        where: { csvDashboardRowId: candidate.rowId },
        create: {
          csvDashboardRowId: candidate.rowId,
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          isCompleted,
          updatedAt: csvUpdatedAt,
        },
        update: {
          isCompleted,
          updatedAt: csvUpdatedAt,
        },
      });
      if (!existing || existing.isCompleted !== isCompleted) {
        const fseibanRaw = rowData?.FSEIBAN;
        const fseiban = typeof fseibanRaw === 'string' ? fseibanRaw.trim() : '';
        await dueManagementLearningEventRepository.saveOutcomeEvent({
          locationKey: params.locationKey?.trim() || '__shared__',
          eventType: 'progress_sync',
          csvDashboardRowId: candidate.rowId,
          fseiban: fseiban.length > 0 ? fseiban : null,
          isCompleted,
          occurredAt: csvUpdatedAt,
          metadata: {
            from: 'csv_progress_sync',
          },
        });
      }
    }
  }
}
