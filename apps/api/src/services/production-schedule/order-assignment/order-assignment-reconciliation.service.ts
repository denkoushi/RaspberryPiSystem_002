import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import {
  findStaleOrderAssignmentCandidates,
  groupStaleCandidatesForRelease,
  releaseOrderAssignmentAtLocation,
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
  const candidates = candidatesOverride ? [...candidatesOverride] : await findStaleOrderAssignmentCandidates(executor);
  const ordered = groupStaleCandidatesForRelease(candidates);

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

export class ProductionScheduleOrderAssignmentReconciliationService {
  constructor(private readonly deps: { prismaClient: typeof prisma } = { prismaClient: prisma }) {}

  async reconcileStaleAssignments(): Promise<OrderAssignmentReconciliationResult> {
    return reconcileStaleProductionScheduleOrderAssignments(this.deps.prismaClient);
  }
}
