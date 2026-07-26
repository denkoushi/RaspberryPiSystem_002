import type {
  AssemblyWorkUnitInvalidation,
  AssemblyWorkUnitInvalidationState
} from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
import { AssemblyTraceabilityAccessService } from './assembly-traceability-access.service.js';
import { isAssemblyUniqueConstraintError } from './assembly-prisma-errors.js';
import type { AssemblyTransactionClient } from './assembly-work-session-lock.repository.js';
import { lockAssemblyWorkUnits } from './assembly-work-unit-lock.repository.js';

export type AssemblyWorkUnitLifecycleActor = {
  username: string | null;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
};

function lifecycleConflict(message: string): ApiError {
  return new ApiError(409, message, undefined, 'ASSEMBLY_WORK_UNIT_INVALIDATION_CONFLICT');
}

function requireReason(value: string): string {
  const reason = value.trim();
  if (reason.length === 0) {
    throw new ApiError(400, '削除理由が必要です');
  }
  if (reason.length > 500) {
    throw new ApiError(400, '削除理由は500文字以内で入力してください');
  }
  return reason;
}

function sourceStateFor(input: {
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | null;
  approved: boolean;
}): AssemblyWorkUnitInvalidationState {
  if (input.status == null) return 'NOT_STARTED';
  if (input.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (input.status === 'COMPLETED') return input.approved ? 'APPROVED' : 'COMPLETED';
  throw lifecycleConflict('取消済みの作業用IDはホーム画面から削除できません');
}

async function lockSessionIfPresent(
  tx: AssemblyTransactionClient,
  sessionId: string | null
): Promise<void> {
  if (!sessionId) return;
  await tx.$queryRaw`
    SELECT "id" FROM "AssemblyWorkSession" WHERE "id" = ${sessionId} FOR UPDATE
  `;
}

const workUnitLifecycleInclude = {
  invalidation: true,
  lotSerial: {
    include: {
      lot: true
    }
  },
  workSession: {
    include: {
      approval: true
    }
  },
  parentCompositionLinks: {
    where: { unlinkedAt: null },
    select: { id: true },
    take: 1
  },
  childCompositionLinks: {
    where: { unlinkedAt: null },
    select: { id: true },
    take: 1
  },
  formalIdentifierAssignments: {
    where: { supersededAt: null },
    select: { id: true },
    take: 1
  }
} as const;

export class AssemblyWorkUnitLifecycleService {
  constructor(
    private readonly accessService = new AssemblyTraceabilityAccessService()
  ) {}

  async invalidate(input: {
    workUnitId: string;
    requestId: string;
    accessPassword: string;
    reason: string;
    actor: AssemblyWorkUnitLifecycleActor;
  }): Promise<AssemblyWorkUnitInvalidation> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const reason = requireReason(input.reason);

    try {
      return await runAssemblyTransaction(async (tx) => {
        const existingRequest = await tx.assemblyWorkUnitInvalidation.findUnique({
          where: { requestId: input.requestId }
        });
        if (existingRequest) {
          if (
            existingRequest.workUnitId !== input.workUnitId ||
            existingRequest.reason !== reason
          ) {
            throw lifecycleConflict('同じrequestIdを別の削除操作には使用できません');
          }
          return existingRequest;
        }

        const target = await tx.assemblyWorkUnit.findUnique({
          where: { id: input.workUnitId },
          select: { id: true }
        });
        if (!target) {
          throw new ApiError(404, '作業用IDが見つかりません');
        }

        await lockAssemblyWorkUnits(tx, [target.id]);
        // 開始処理との競合中にセッションが作成される可能性があるため、
        // WorkUnitを取得した後の最新sessionIdを読み、必ずWorkUnit→Sessionの順でロックする。
        const lockedTarget = await tx.assemblyWorkUnit.findUnique({
          where: { id: target.id },
          select: { workSession: { select: { id: true } } }
        });
        await lockSessionIfPresent(tx, lockedTarget?.workSession?.id ?? null);
        const idempotentAfterLock = await tx.assemblyWorkUnitInvalidation.findUnique({
          where: { requestId: input.requestId }
        });
        if (idempotentAfterLock) {
          if (
            idempotentAfterLock.workUnitId !== input.workUnitId ||
            idempotentAfterLock.reason !== reason
          ) {
            throw lifecycleConflict('同じrequestIdを別の削除操作には使用できません');
          }
          return idempotentAfterLock;
        }
        const workUnit = await tx.assemblyWorkUnit.findUnique({
          where: { id: target.id },
          include: workUnitLifecycleInclude
        });
        if (!workUnit) {
          throw new ApiError(404, '作業用IDが見つかりません');
        }
        if (workUnit.invalidatedAt || workUnit.invalidation) {
          throw lifecycleConflict('この作業用IDは既に削除済みです');
        }
        if (
          workUnit.parentCompositionLinks.length > 0 ||
          workUnit.childCompositionLinks.length > 0
        ) {
          throw lifecycleConflict('有効な製品構成を解除してから削除してください');
        }
        if (workUnit.formalIdentifierAssignments.length > 0) {
          throw lifecycleConflict('正式IDが有効な作業用IDは削除できません');
        }

        const sourceState = sourceStateFor({
          status: workUnit.workSession?.status ?? null,
          approved: workUnit.workSession?.approval != null
        });
        const invalidatedAt = new Date();

        if (workUnit.workSession?.status === 'IN_PROGRESS') {
          await tx.assemblyWorkSession.update({
            where: { id: workUnit.workSession.id },
            data: {
              status: 'CANCELLED',
              cancelledAt: invalidatedAt,
              cancelReason: reason
            }
          });
        }
        await tx.assemblyWorkUnit.update({
          where: { id: workUnit.id },
          data: { invalidatedAt }
        });
        return tx.assemblyWorkUnitInvalidation.create({
          data: {
            workUnitId: workUnit.id,
            requestId: input.requestId,
            sourceState,
            productNoSnapshot:
              workUnit.workSession?.productNo ?? workUnit.lotSerial?.lot.productNo ?? null,
            workIdSnapshot: workUnit.workId,
            lotIdSnapshot: workUnit.lotSerial?.lotId ?? null,
            lotSerialIdSnapshot: workUnit.lotSerial?.id ?? null,
            workSessionIdSnapshot: workUnit.workSession?.id ?? null,
            reason,
            invalidatedByUsernameSnapshot: input.actor.username,
            invalidatedByClientDeviceId: input.actor.clientDeviceId,
            invalidatedByClientDeviceNameSnapshot:
              input.actor.clientDeviceNameSnapshot,
            invalidatedAt
          }
        });
      });
    } catch (error) {
      if (isAssemblyUniqueConstraintError(error)) {
        throw lifecycleConflict('このrequestIdまたは作業用IDは既に別の削除操作で使用されています');
      }
      throw error;
    }
  }
}
