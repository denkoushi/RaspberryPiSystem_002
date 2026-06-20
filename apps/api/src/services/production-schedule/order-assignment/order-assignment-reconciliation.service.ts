import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import {
  findStaleOrderAssignmentCandidates,
  findStaleSplitOrderAssignmentCandidates,
  groupStaleCandidatesForRelease,
  groupStaleSplitCandidatesForRelease,
  releaseOrderAssignmentAtLocation,
  releaseSplitOrderAssignmentAtLocation,
  type OrderAssignmentReconciliationResult,
  type OrderAssignmentReleaseTarget,
  type PrismaOrderAssignmentExecutor
} from './order-assignment-release.repository.js';

export type { OrderAssignmentReleaseTarget, OrderAssignmentReconciliationResult };

/**
 * 1 行・1 location の順位割当を削除し、同一資源内で番号を詰める。
 */
export async function releaseProductionScheduleOrderAssignment(
  executor: PrismaOrderAssignmentExecutor,
  target: OrderAssignmentReleaseTarget
): Promise<boolean> {
  const result = await releaseOrderAssignmentAtLocation(executor, target);
  return result.released;
}

/**
 * 実効完了（A）または一覧非表示（α）の winner 行に紐づく幽霊割当を一括解放する。
 */
export async function reconcileStaleProductionScheduleOrderAssignments(
  executor: PrismaOrderAssignmentExecutor = prisma,
  candidatesOverride?: ReadonlyArray<{ csvDashboardRowId: string; location: string; resourceCd: string; orderNumber: number }>
): Promise<OrderAssignmentReconciliationResult> {
  if (candidatesOverride) {
    const ordered = groupStaleCandidatesForRelease(candidatesOverride);
    let released = 0;
    for (const candidate of ordered) {
      const result = await releaseOrderAssignmentAtLocation(executor, {
        csvDashboardRowId: candidate.csvDashboardRowId,
        location: candidate.location
      });
      if (result.released) {
        released += 1;
      }
    }

    if (released > 0) {
      logger.info(
        { scanned: ordered.length, released },
        '[ProductionScheduleOrderAssignmentReconciliation] stale order assignments released'
      );
    }

    return { scanned: ordered.length, released };
  }

  const parentCandidates = await findStaleOrderAssignmentCandidates(executor);
  const orderedParent = groupStaleCandidatesForRelease(parentCandidates);
  const splitCandidates = await findStaleSplitOrderAssignmentCandidates(executor);
  const orderedSplit = groupStaleSplitCandidatesForRelease(splitCandidates);

  let released = 0;
  for (const candidate of orderedParent) {
    const result = await releaseOrderAssignmentAtLocation(executor, {
      csvDashboardRowId: candidate.csvDashboardRowId,
      location: candidate.location
    });
    if (result.released) {
      released += 1;
    }
  }

  for (const candidate of orderedSplit) {
    const result = await releaseSplitOrderAssignmentAtLocation(executor, {
      splitId: candidate.splitId,
      location: candidate.location
    });
    if (result.released) {
      released += 1;
    }
  }

  const scanned = orderedParent.length + orderedSplit.length;
  if (released > 0) {
    logger.info(
      { scanned, released, parentCandidates: orderedParent.length, splitCandidates: orderedSplit.length },
      '[ProductionScheduleOrderAssignmentReconciliation] stale order assignments released'
    );
  }

  return { scanned, released };
}

export class ProductionScheduleOrderAssignmentReconciliationService {
  constructor(private readonly deps: { prismaClient: typeof prisma } = { prismaClient: prisma }) {}

  async reconcileStaleAssignments(): Promise<OrderAssignmentReconciliationResult> {
    return reconcileStaleProductionScheduleOrderAssignments(this.deps.prismaClient);
  }
}
