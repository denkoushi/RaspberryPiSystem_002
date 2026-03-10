import type { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildActualHoursCanonicalLogicalKeyHash } from './actual-hours-logical-key.js';
import {
  shouldReplaceActualHoursWinner,
  type ActualHoursWinnerSnapshot,
} from './actual-hours-winner-policy.js';

type CanonicalRowSnapshot = {
  id: string;
  logicalKeyHash: string;
  rawId: string;
  workDate: Date;
  rawCreatedAt: Date;
  rawUpdatedAt: Date;
};

type RawRowSnapshot = {
  id: string;
  sourceFileKey: string;
  sourceMessageId: string | null;
  sourceScheduleId: string | null;
  workDate: Date;
  fseiban: string | null;
  fhincd: string;
  lotNo: string | null;
  lotQty: number;
  resourceCd: string;
  processOrder: number | null;
  actualMinutes: number;
  perPieceMinutes: number;
  isExcluded: boolean;
  excludeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CanonicalCandidate = {
  logicalKeyHash: string;
  row: RawRowSnapshot;
};

export type ActualHoursCanonicalResolveResult = {
  sourceRows: number;
  candidateKeys: number;
  canonicalCreated: number;
  canonicalUpdated: number;
  canonicalSkipped: number;
};

const toWinnerSnapshotFromRaw = (row: RawRowSnapshot): ActualHoursWinnerSnapshot => ({
  rawId: row.id,
  explicitUpdatedAt: null,
  workDate: row.workDate,
  rawUpdatedAt: row.updatedAt,
  rawCreatedAt: row.createdAt,
});

const toWinnerSnapshotFromCanonical = (row: CanonicalRowSnapshot): ActualHoursWinnerSnapshot => ({
  rawId: row.rawId,
  explicitUpdatedAt: null,
  workDate: row.workDate,
  rawUpdatedAt: row.rawUpdatedAt,
  rawCreatedAt: row.rawCreatedAt,
});

export class ActualHoursCanonicalResolverService {
  async rebuildForSource(params: {
    locationKey: string;
    sourceFileKey: string;
    csvDashboardId?: string;
  }): Promise<ActualHoursCanonicalResolveResult> {
    const csvDashboardId = params.csvDashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID;
    const rawRows = await prisma.productionScheduleActualHoursRaw.findMany({
      where: {
        csvDashboardId,
        sourceFileKey: params.sourceFileKey,
      },
      select: {
        id: true,
        sourceFileKey: true,
        sourceMessageId: true,
        sourceScheduleId: true,
        workDate: true,
        fseiban: true,
        fhincd: true,
        lotNo: true,
        lotQty: true,
        resourceCd: true,
        processOrder: true,
        actualMinutes: true,
        perPieceMinutes: true,
        isExcluded: true,
        excludeReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return this.upsertCanonical({
      csvDashboardId,
      locationKey: params.locationKey,
      rawRows,
    });
  }

  async rebuildAll(params: {
    locationKey: string;
    csvDashboardId?: string;
  }): Promise<ActualHoursCanonicalResolveResult> {
    const csvDashboardId = params.csvDashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID;
    const rawRows = await prisma.productionScheduleActualHoursRaw.findMany({
      where: { csvDashboardId },
      select: {
        id: true,
        sourceFileKey: true,
        sourceMessageId: true,
        sourceScheduleId: true,
        workDate: true,
        fseiban: true,
        fhincd: true,
        lotNo: true,
        lotQty: true,
        resourceCd: true,
        processOrder: true,
        actualMinutes: true,
        perPieceMinutes: true,
        isExcluded: true,
        excludeReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return this.upsertCanonical({
      csvDashboardId,
      locationKey: params.locationKey,
      rawRows,
    });
  }

  private async upsertCanonical(params: {
    csvDashboardId: string;
    locationKey: string;
    rawRows: RawRowSnapshot[];
  }): Promise<ActualHoursCanonicalResolveResult> {
    if (params.rawRows.length === 0) {
      return {
        sourceRows: 0,
        candidateKeys: 0,
        canonicalCreated: 0,
        canonicalUpdated: 0,
        canonicalSkipped: 0,
      };
    }

    const candidateByKey = new Map<string, CanonicalCandidate>();
    for (const row of params.rawRows) {
      const logicalKeyHash = buildActualHoursCanonicalLogicalKeyHash({
        fhincd: row.fhincd,
        resourceCd: row.resourceCd,
        workDate: row.workDate,
        processOrder: row.processOrder,
        fseiban: row.fseiban,
        lotNo: row.lotNo,
      });
      const candidate = candidateByKey.get(logicalKeyHash);
      if (!candidate) {
        candidateByKey.set(logicalKeyHash, { logicalKeyHash, row });
        continue;
      }
      if (shouldReplaceActualHoursWinner(toWinnerSnapshotFromRaw(row), toWinnerSnapshotFromRaw(candidate.row))) {
        candidateByKey.set(logicalKeyHash, { logicalKeyHash, row });
      }
    }

    const logicalKeyHashes = Array.from(candidateByKey.keys());
    const existingRows = logicalKeyHashes.length
      ? await prisma.productionScheduleActualHoursCanonical.findMany({
          where: {
            csvDashboardId: params.csvDashboardId,
            location: params.locationKey,
            logicalKeyHash: { in: logicalKeyHashes },
          },
          select: {
            id: true,
            logicalKeyHash: true,
            rawId: true,
            workDate: true,
            rawCreatedAt: true,
            rawUpdatedAt: true,
          },
        })
      : [];

    const existingByKey = new Map(existingRows.map((row) => [row.logicalKeyHash, row] as const));
    const creates: Prisma.ProductionScheduleActualHoursCanonicalCreateManyInput[] = [];
    const updates: Array<{
      id: string;
      data: Prisma.ProductionScheduleActualHoursCanonicalUpdateInput;
    }> = [];
    let skipped = 0;

    for (const [logicalKeyHash, candidate] of candidateByKey.entries()) {
      const existing = existingByKey.get(logicalKeyHash);
      const winnerRule = existing ? 'canonical_winner_policy_update' : 'canonical_winner_policy_create';
      const winnerAt = candidate.row.updatedAt;
      if (!existing) {
        creates.push({
          csvDashboardId: params.csvDashboardId,
          location: params.locationKey,
          logicalKeyHash,
          rawId: candidate.row.id,
          sourceFileKey: candidate.row.sourceFileKey,
          sourceMessageId: candidate.row.sourceMessageId,
          sourceScheduleId: candidate.row.sourceScheduleId,
          winnerRule,
          winnerAt,
          rawCreatedAt: candidate.row.createdAt,
          rawUpdatedAt: candidate.row.updatedAt,
          workDate: candidate.row.workDate,
          fseiban: candidate.row.fseiban,
          fhincd: candidate.row.fhincd,
          lotNo: candidate.row.lotNo,
          lotQty: candidate.row.lotQty,
          resourceCd: candidate.row.resourceCd,
          processOrder: candidate.row.processOrder,
          actualMinutes: candidate.row.actualMinutes,
          perPieceMinutes: candidate.row.perPieceMinutes,
          isExcluded: candidate.row.isExcluded,
          excludeReason: candidate.row.excludeReason,
        });
        continue;
      }

      const shouldReplace = shouldReplaceActualHoursWinner(
        toWinnerSnapshotFromRaw(candidate.row),
        toWinnerSnapshotFromCanonical(existing)
      );
      if (!shouldReplace) {
        skipped += 1;
        continue;
      }

      updates.push({
        id: existing.id,
        data: {
          rawId: candidate.row.id,
          sourceFileKey: candidate.row.sourceFileKey,
          sourceMessageId: candidate.row.sourceMessageId,
          sourceScheduleId: candidate.row.sourceScheduleId,
          winnerRule,
          winnerAt,
          rawCreatedAt: candidate.row.createdAt,
          rawUpdatedAt: candidate.row.updatedAt,
          workDate: candidate.row.workDate,
          fseiban: candidate.row.fseiban,
          fhincd: candidate.row.fhincd,
          lotNo: candidate.row.lotNo,
          lotQty: candidate.row.lotQty,
          resourceCd: candidate.row.resourceCd,
          processOrder: candidate.row.processOrder,
          actualMinutes: candidate.row.actualMinutes,
          perPieceMinutes: candidate.row.perPieceMinutes,
          isExcluded: candidate.row.isExcluded,
          excludeReason: candidate.row.excludeReason,
        },
      });
    }

    let createdCount = 0;
    if (creates.length > 0) {
      const createResult = await prisma.productionScheduleActualHoursCanonical.createMany({
        data: creates,
        skipDuplicates: true,
      });
      createdCount = createResult.count;
    }

    if (updates.length > 0) {
      const chunkSize = 100;
      for (let index = 0; index < updates.length; index += chunkSize) {
        const chunk = updates.slice(index, index + chunkSize);
        await prisma.$transaction(
          chunk.map((item) =>
            prisma.productionScheduleActualHoursCanonical.update({
              where: { id: item.id },
              data: item.data,
            })
          )
        );
      }
    }

    return {
      sourceRows: params.rawRows.length,
      candidateKeys: logicalKeyHashes.length,
      canonicalCreated: createdCount,
      canonicalUpdated: updates.length,
      canonicalSkipped: skipped,
    };
  }
}
