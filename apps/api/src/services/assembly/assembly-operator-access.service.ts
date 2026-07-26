import type {
  AssemblyOperatorAccessType,
  AssemblyWorkSessionOperatorAccess
} from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import {
  assemblyWorkSessionDetailInclude,
  type AssemblyWorkSessionDetail
} from './assembly-work-session-detail.js';
import { resolveActiveAssemblyOperatorNfcUid } from './assembly-operator-nfc-resolve.service.js';
import type { AssemblyOperatorNfcResolveResult } from './assembly-operator-nfc-resolve.service.js';
import {
  runLockedAssemblyWorkSessionTransaction
} from './assembly-transaction.js';
import { isAssemblyUniqueConstraintError } from './assembly-prisma-errors.js';
import type { AssemblyTransactionClient } from './assembly-work-session-lock.repository.js';

export type AssemblyOperatorAccessActor = {
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
};

export function assemblyOperatorAccessConflict(message: string): ApiError {
  return new ApiError(409, message, undefined, 'ASSEMBLY_OPERATOR_ACCESS_CONFLICT');
}

export async function findIdempotentAssemblyOperatorAccess(
  tx: AssemblyTransactionClient,
  input: {
    requestId: string;
    accessType: AssemblyOperatorAccessType;
    operatorNfcTagUid: string;
    sessionId?: string;
    lotSerialId?: string;
    workId?: string;
  }
): Promise<AssemblyWorkSessionDetail | null> {
  const existing = await tx.assemblyWorkSessionOperatorAccess.findUnique({
    where: { requestId: input.requestId },
    include: {
      session: { include: assemblyWorkSessionDetailInclude }
    }
  });
  if (!existing) return null;
  const expectedUid = input.operatorNfcTagUid.trim();
  if (
    existing.accessType !== input.accessType ||
    existing.employeeNfcTagUidSnapshot !== expectedUid ||
    (input.sessionId != null && existing.sessionId !== input.sessionId) ||
    (input.lotSerialId != null && existing.session.lotSerialId !== input.lotSerialId) ||
    (input.workId != null && existing.session.workId !== input.workId)
  ) {
    throw assemblyOperatorAccessConflict('同じrequestIdを別の作業者アクセスには使用できません');
  }
  return existing.session;
}

export async function appendAssemblyOperatorAccess(
  tx: AssemblyTransactionClient,
  input: {
    sessionId: string;
    accessType: AssemblyOperatorAccessType;
    requestId: string;
    operatorNfcTagUid: string;
    actor: AssemblyOperatorAccessActor;
    operator?: AssemblyOperatorNfcResolveResult;
  }
): Promise<AssemblyWorkSessionOperatorAccess> {
  const employee =
    input.operator ??
    await resolveActiveAssemblyOperatorNfcUid(tx, input.operatorNfcTagUid);
  return tx.assemblyWorkSessionOperatorAccess.create({
    data: {
      sessionId: input.sessionId,
      employeeId: employee.employeeId,
      accessType: input.accessType,
      requestId: input.requestId,
      employeeCodeSnapshot: employee.employeeCode,
      employeeNameSnapshot: employee.displayName,
      employeeNfcTagUidSnapshot: employee.nfcTagUid,
      clientDeviceId: input.actor.clientDeviceId,
      clientDeviceNameSnapshot: input.actor.clientDeviceNameSnapshot
    }
  });
}

export class AssemblyOperatorAccessService {
  async recordResume(input: {
    sessionId: string;
    requestId: string;
    operatorNfcTagUid: string;
    actor: AssemblyOperatorAccessActor;
  }): Promise<AssemblyWorkSessionDetail> {
    try {
      return await runLockedAssemblyWorkSessionTransaction(input.sessionId, async (tx, session) => {
        const idempotent = await findIdempotentAssemblyOperatorAccess(tx, {
          requestId: input.requestId,
          accessType: 'RESUME',
          operatorNfcTagUid: input.operatorNfcTagUid,
          sessionId: input.sessionId
        });
        if (idempotent) return idempotent;
        if (session.status !== 'IN_PROGRESS') {
          throw assemblyOperatorAccessConflict('進行中の作業だけ再開できます');
        }
        if (session.workUnit?.invalidatedAt) {
          throw assemblyOperatorAccessConflict('削除済みの作業用IDは再開できません');
        }

        const access = await appendAssemblyOperatorAccess(tx, {
          sessionId: session.id,
          accessType: 'RESUME',
          requestId: input.requestId,
          operatorNfcTagUid: input.operatorNfcTagUid,
          actor: input.actor
        });
        return tx.assemblyWorkSession.update({
          where: { id: session.id },
          data: {
            operatorEmployeeId: access.employeeId,
            operatorNameSnapshot: access.employeeNameSnapshot,
            clientDeviceId: input.actor.clientDeviceId ?? session.clientDeviceId,
            clientDeviceNameSnapshot:
              input.actor.clientDeviceNameSnapshot ?? session.clientDeviceNameSnapshot
          },
          include: assemblyWorkSessionDetailInclude
        });
      });
    } catch (error) {
      if (isAssemblyUniqueConstraintError(error)) {
        throw assemblyOperatorAccessConflict('同じrequestIdは既に別の作業者アクセスで使用されています');
      }
      throw error;
    }
  }
}
