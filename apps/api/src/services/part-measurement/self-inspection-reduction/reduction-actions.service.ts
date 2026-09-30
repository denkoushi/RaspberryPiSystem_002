import type { Prisma, SelfInspectionChangePointKind } from '@prisma/client';
import {
  SELF_INSPECTION_REDUCTION_VERDICT_LABELS,
  judgeSelfInspectionReduction,
  selfInspectionReductionLevelLabel,
  type SelfInspectionReductionCpkThreshold
} from '@raspi-system/shared-types';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { parseSelfInspectionModeDto } from '../self-inspection-config.js';

import type { ReductionPartKeyFilter } from './reduction-insights.service.js';
import { getSelfInspectionReductionInsights } from './reduction-insights.service.js';
import { getSelfInspectionReductionPolicy, requireActiveEmployeeByTag } from './reduction-policy.service.js';

export async function recordSelfInspectionChangePoint(input: {
  key: ReductionPartKeyFilter;
  kind: SelfInspectionChangePointKind;
  employeeTagUid: string;
  clientDeviceId: string | null;
}) {
  const employee = await requireActiveEmployeeByTag(input.employeeTagUid);
  const row = await prisma.selfInspectionChangePoint.create({
    data: {
      fhincd: input.key.fhincd,
      processGroup: input.key.processGroup,
      resourceCd: input.key.resourceCd,
      kind: input.kind,
      recordedByEmployeeId: employee.id,
      recordedByEmployeeCodeSnapshot: employee.employeeCode,
      recordedByEmployeeNameSnapshot: employee.displayName,
      clientDeviceId: input.clientDeviceId
    }
  });
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    recordedByName: row.recordedByEmployeeNameSnapshot
  };
}

/**
 * 検査レベル変更の承認を記録する（運用A: 記録のみ）。
 * 画面で見た判定を、同じ期間・同じ Cpk 基準でサーバー側でも再判定してから保存する。
 */
export async function recordSelfInspectionLevelDecision(input: {
  key: ReductionPartKeyFilter;
  direction: 'reduce' | 'restore';
  periodDays: number;
  cpkThreshold: SelfInspectionReductionCpkThreshold;
  approverEmployeeTagUid: string;
  clientDeviceId: string | null;
}) {
  const employee = await requireActiveEmployeeByTag(input.approverEmployeeTagUid);
  const approvers = await prisma.selfInspectionReductionApprover.findMany({ select: { employeeId: true } });
  if (approvers.length === 0) {
    throw new ApiError(409, '承認できる人が設定されていません。判定設定で追加してください');
  }
  if (!approvers.some((approver) => approver.employeeId === employee.id)) {
    throw new ApiError(403, `${employee.displayName} は承認できる人に登録されていません`);
  }

  const savedPolicy = await getSelfInspectionReductionPolicy();
  const policy = {
    cpkThreshold: input.cpkThreshold,
    requiredConsecutiveLots: savedPolicy.requiredConsecutiveLots,
    minimumSampleCount: savedPolicy.minimumSampleCount,
    resetStreakOnChangePoint: savedPolicy.resetStreakOnChangePoint
  };
  const insights = await getSelfInspectionReductionInsights({ periodDays: input.periodDays, key: input.key });
  const part = insights.parts[0];
  if (!part) {
    throw new ApiError(404, '期間内に完了した自主検査の記録がありません');
  }
  const judgement = judgeSelfInspectionReduction(part.metrics, policy);
  if (judgement.verdict !== input.direction || !judgement.target) {
    throw new ApiError(
      409,
      `いまの判定は「${SELF_INSPECTION_REDUCTION_VERDICT_LABELS[judgement.verdict]}」のため承認できません`
    );
  }

  const from = part.metrics.level;
  const to = judgement.target;
  const metricsSnapshot = {
    periodDays: input.periodDays,
    policy,
    metrics: part.metrics,
    checks: judgement.checks,
    effectiveConsecutivePassLots: judgement.effectiveConsecutivePassLots,
    worstItemKey: part.worstItemKey,
    lotCount: part.lotCount
  } satisfies Prisma.InputJsonValue;

  const row = await prisma.selfInspectionLevelDecision.create({
    data: {
      fhincd: input.key.fhincd,
      processGroup: input.key.processGroup,
      resourceCd: input.key.resourceCd,
      templateIdSnapshot: part.templateId,
      templateVersionSnapshot: part.templateVersion,
      direction: input.direction === 'restore' ? 'RESTORE' : 'REDUCE',
      fromMode: parseSelfInspectionModeDto(from.mode),
      fromFixedCount: from.fixedCount,
      toMode: parseSelfInspectionModeDto(to.mode),
      toFixedCount: to.fixedCount,
      cpkThreshold: input.cpkThreshold,
      metricsSnapshot,
      approverEmployeeId: employee.id,
      approverEmployeeCodeSnapshot: employee.employeeCode,
      approverEmployeeNameSnapshot: employee.displayName,
      clientDeviceId: input.clientDeviceId
    }
  });

  return {
    id: row.id,
    direction: input.direction,
    fromLabel: selfInspectionReductionLevelLabel(from),
    toLevel: to,
    toLabel: selfInspectionReductionLevelLabel(to),
    decidedAt: row.decidedAt.toISOString(),
    approverName: employee.displayName
  };
}
