import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assemblyWorkSessionDetailInclude, type AssemblyWorkSessionDetail } from './assembly-work-session.service.js';

export type AssemblyWorkSessionApprovalSnapshot = {
  approvedAt: Date;
  approverEmployeeId: string | null;
  approverEmployeeCodeSnapshot: string;
  approverEmployeeNameSnapshot: string;
  approverNfcTagUidSnapshot: string;
  comment: string | null;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
};

export function serializeAssemblyWorkSessionApproval(
  approval: AssemblyWorkSessionApprovalSnapshot | null | undefined
) {
  if (!approval) return null;
  return {
    approvedAt: approval.approvedAt.toISOString(),
    approverEmployeeId: approval.approverEmployeeId,
    approverEmployeeCodeSnapshot: approval.approverEmployeeCodeSnapshot,
    approverEmployeeNameSnapshot: approval.approverEmployeeNameSnapshot,
    approverNfcTagUidSnapshot: approval.approverNfcTagUidSnapshot,
    comment: approval.comment,
    clientDeviceId: approval.clientDeviceId,
    clientDeviceNameSnapshot: approval.clientDeviceNameSnapshot
  };
}

export class AssemblyWorkSessionRecordApprovalService {
  async approve(sessionId: string, input: {
    approverEmployeeTagUid: string;
    comment?: string | null;
    clientDeviceId?: string | null;
  }): Promise<AssemblyWorkSessionDetail> {
    const tagUid = input.approverEmployeeTagUid.trim();
    if (!tagUid) {
      throw new ApiError(400, '承認者NFCタグが必要です');
    }
    const comment = input.comment?.trim() || null;

    return prisma.$transaction(async (tx) => {
      const session = await tx.assemblyWorkSession.findUnique({
        where: { id: sessionId },
        include: {
          approval: true
        }
      });
      if (!session) {
        throw new ApiError(404, '作業セッションが見つかりません');
      }
      if (session.status !== 'COMPLETED') {
        throw new ApiError(409, '完了した作業のみ承認できます');
      }
      if (session.approval) {
        throw new ApiError(409, 'この組立記録は既に承認済みです');
      }

      const approver = await tx.employee.findFirst({
        where: { nfcTagUid: tagUid },
        select: {
          id: true,
          employeeCode: true,
          displayName: true,
          nfcTagUid: true,
          status: true
        }
      });
      if (!approver?.nfcTagUid) {
        throw new ApiError(404, '社員タグが見つかりません');
      }
      if (approver.status !== 'ACTIVE') {
        throw new ApiError(403, '有効な社員のみ承認できます');
      }

      const clientDevice = input.clientDeviceId
        ? await tx.clientDevice.findUnique({
            where: { id: input.clientDeviceId },
            select: { id: true, name: true }
          })
        : null;

      await tx.assemblyWorkSessionApproval.create({
        data: {
          sessionId: session.id,
          approverEmployeeId: approver.id,
          approverEmployeeCodeSnapshot: approver.employeeCode,
          approverEmployeeNameSnapshot: approver.displayName,
          approverNfcTagUidSnapshot: approver.nfcTagUid,
          comment,
          clientDeviceId: clientDevice?.id ?? null,
          clientDeviceNameSnapshot: clientDevice?.name ?? null
        }
      });

      const updated = await tx.assemblyWorkSession.findUnique({
        where: { id: sessionId },
        include: assemblyWorkSessionDetailInclude
      });
      if (!updated) {
        throw new ApiError(404, '作業セッションが見つかりません');
      }
      return updated;
    });
  }
}
