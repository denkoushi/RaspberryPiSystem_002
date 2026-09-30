import {
  DEFAULT_SELF_INSPECTION_REDUCTION_POLICY,
  isSelfInspectionReductionCpkThreshold,
  type SelfInspectionReductionPolicy
} from '@raspi-system/shared-types';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { resolveSelfInspectionRecordApprovalApprover } from '../self-inspection/use-cases/record-approval.js';

export const SELF_INSPECTION_REDUCTION_POLICY_KEY = 'shared';

export type SelfInspectionReductionApproverDto = {
  id: string;
  employeeId: string;
  employeeCode: string;
  displayName: string;
  createdAt: string;
};

export type SelfInspectionReductionPolicyDto = SelfInspectionReductionPolicy & {
  updatedAt: string | null;
  updatedBy: string | null;
};

export async function getSelfInspectionReductionPolicy(): Promise<SelfInspectionReductionPolicyDto> {
  const row = await prisma.selfInspectionReductionPolicyConfig.findUnique({
    where: { key: SELF_INSPECTION_REDUCTION_POLICY_KEY }
  });
  if (!row) {
    return { ...DEFAULT_SELF_INSPECTION_REDUCTION_POLICY, updatedAt: null, updatedBy: null };
  }
  const threshold = row.cpkThreshold.toNumber();
  return {
    cpkThreshold: isSelfInspectionReductionCpkThreshold(threshold)
      ? threshold
      : DEFAULT_SELF_INSPECTION_REDUCTION_POLICY.cpkThreshold,
    requiredConsecutiveLots: row.requiredConsecutiveLots,
    minimumSampleCount: row.minimumSampleCount,
    resetStreakOnChangePoint: row.resetStreakOnChangePoint,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
  };
}

export async function updateSelfInspectionReductionPolicy(
  policy: SelfInspectionReductionPolicy,
  updatedBy: string | null
): Promise<SelfInspectionReductionPolicyDto> {
  const data = {
    cpkThreshold: policy.cpkThreshold,
    requiredConsecutiveLots: policy.requiredConsecutiveLots,
    minimumSampleCount: policy.minimumSampleCount,
    resetStreakOnChangePoint: policy.resetStreakOnChangePoint,
    updatedBy: updatedBy?.trim() || null
  };
  await prisma.selfInspectionReductionPolicyConfig.upsert({
    where: { key: SELF_INSPECTION_REDUCTION_POLICY_KEY },
    create: { key: SELF_INSPECTION_REDUCTION_POLICY_KEY, ...data },
    update: data
  });
  return getSelfInspectionReductionPolicy();
}

export async function listSelfInspectionReductionApprovers(): Promise<SelfInspectionReductionApproverDto[]> {
  const rows = await prisma.selfInspectionReductionApprover.findMany({
    orderBy: { createdAt: 'asc' },
    include: { employee: { select: { employeeCode: true, displayName: true } } }
  });
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employeeCode: row.employee.employeeCode,
    displayName: row.employee.displayName,
    createdAt: row.createdAt.toISOString()
  }));
}

/** 社員NFCタグを有効な社員へ解決する。承認者・変化点の記録者で共通に使う。 */
export async function requireActiveEmployeeByTag(rawUid: string) {
  const result = await resolveSelfInspectionRecordApprovalApprover(rawUid);
  switch (result.kind) {
    case 'employee':
      return result.employee;
    case 'inactive':
      throw new ApiError(400, '有効な社員タグではありません');
    case 'instrument':
      throw new ApiError(400, '計測機器タグです。社員タグをタッチしてください');
    case 'duplicate':
      throw new ApiError(409, '同一タグが社員と計測機器の両方に登録されています');
    default:
      throw new ApiError(404, '未登録のNFCタグです');
  }
}

export async function addSelfInspectionReductionApprover(
  employeeTagUid: string,
  addedBy: string | null
): Promise<SelfInspectionReductionApproverDto[]> {
  const employee = await requireActiveEmployeeByTag(employeeTagUid);
  await prisma.selfInspectionReductionApprover.upsert({
    where: { employeeId: employee.id },
    create: {
      employeeId: employee.id,
      employeeCodeSnapshot: employee.employeeCode,
      employeeNameSnapshot: employee.displayName,
      addedBy: addedBy?.trim() || null
    },
    update: {}
  });
  return listSelfInspectionReductionApprovers();
}

export async function removeSelfInspectionReductionApprover(
  approverId: string
): Promise<SelfInspectionReductionApproverDto[]> {
  await prisma.selfInspectionReductionApprover.deleteMany({ where: { id: approverId } });
  return listSelfInspectionReductionApprovers();
}
