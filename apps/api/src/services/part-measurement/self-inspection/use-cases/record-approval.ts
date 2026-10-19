import type { PartMeasurementProcessGroup } from '@prisma/client';

import { ApiError } from '../../../../lib/errors.js';
import { prisma } from '../../../../lib/prisma.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../../self-inspection-machine-board-cache-invalidation.js';
import { assertSelfInspectionSessionActive } from '../../self-inspection-invalidation-errors.js';
import { loadParticipantSummariesBySessionIds } from '../../self-inspection-participant-names.query.js';
import { getSelfInspectionRegistrationPolicy } from '../../self-inspection-registration-policy.service.js';
import { listRequiredEntrySlots } from '../../self-inspection-config.js';
import { confirmedEntriesCountSelect, confirmedWhere } from '../entry-persistence-status.js';
import { assertAllEntriesReviewReady, assertSessionEntryCountWritable, lockSessionRow } from '../mutation-guards.js';
import { templateConfigFromTemplate } from '../shared.js';
import {
  buildRecordApprovalReadiness,
  loadPendingReviewCountsBySessionIds,
  recordApprovalSessionInclude,
  requiredRegistrationLabelForPolicy,
  serializeRecordApprovalEntryDetail,
  serializeRecordApprovalSessionListItem,
  serializeSessionSummary,
  type SelfInspectionApproverResolveResult,
  type SelfInspectionRecordApprovalState
} from '../serialization.js';
import { partMeasurementTemplateFullInclude } from '../../part-measurement-template-include.js';
import { LIST_SESSIONS_MAX } from './constants.js';
import {
  buildSelfInspectionRecordApprovalWhere,
  SELF_INSPECTION_RECORD_APPROVAL_SCOPE_COMPLETED_RECORDS,
  type SelfInspectionRecordApprovalScope
} from '../record-approval-filter.js';

export async function listSelfInspectionRecordApprovalSessions(query: {
  productNo?: string;
  resourceCd?: string;
  processGroup?: PartMeasurementProcessGroup;
  state?: 'active' | SelfInspectionRecordApprovalState;
  scope?: SelfInspectionRecordApprovalScope;
}) {
  if (query.scope && query.state) {
    throw new ApiError(400, 'scope と state は同時に指定できません');
  }
  const state = query.state ?? 'active';
  const rows = await prisma.selfInspectionSession.findMany({
    where: buildSelfInspectionRecordApprovalWhere(query),
    include: recordApprovalSessionInclude,
    orderBy: [{ updatedAt: 'desc' }],
    take: LIST_SESSIONS_MAX + 1
  });
  const truncated = rows.length > LIST_SESSIONS_MAX;
  const boundedRows = truncated ? rows.slice(0, LIST_SESSIONS_MAX) : rows;
  const registrationPolicy = await getSelfInspectionRegistrationPolicy();
  const sessions = boundedRows
    .map((row) => serializeRecordApprovalSessionListItem(row, registrationPolicy))
    .filter(
      (row) =>
        query.scope === SELF_INSPECTION_RECORD_APPROVAL_SCOPE_COMPLETED_RECORDS ||
        state === 'active' ||
        row.recordApprovalState === state
    );
  return { sessions, listLimit: LIST_SESSIONS_MAX, truncated };
}

export async function getSelfInspectionRecordApprovalSessionDetail(sessionId: string) {
  const session = await prisma.selfInspectionSession.findUnique({
    where: { id: sessionId },
    include: recordApprovalSessionInclude
  });
  if (!session || !session.recordApprovalRequiredAt) {
    throw new ApiError(404, '検査記録確認対象の自主検査セッションが見つかりません');
  }
  assertSelfInspectionSessionActive(session);
  const registrationPolicy = await getSelfInspectionRegistrationPolicy();
  const summary = serializeRecordApprovalSessionListItem(session, registrationPolicy);
  const requiredSlots = listRequiredEntrySlots(
    templateConfigFromTemplate(session.template),
    session.plannedQuantity
  );
  return {
    ...summary,
    requiredEntries: requiredSlots.map((slot) =>
      serializeRecordApprovalEntryDetail(session, slot, registrationPolicy)
    )
  };
}

export async function resolveSelfInspectionRecordApprovalApprover(
  rawUid: string
): Promise<SelfInspectionApproverResolveResult> {
  const uid = rawUid.trim();
  if (!uid) return { kind: 'unknown' };
  const [employee, instrumentTag] = await Promise.all([
    prisma.employee.findFirst({
      where: { nfcTagUid: uid },
      select: { id: true, employeeCode: true, displayName: true, nfcTagUid: true, status: true }
    }),
    prisma.measuringInstrumentTag.findUnique({
      where: { rfidTagUid: uid },
      select: { id: true }
    })
  ]);
  const hasEmployee = Boolean(employee?.nfcTagUid);
  const hasInstrument = Boolean(instrumentTag);
  if (hasEmployee && hasInstrument) return { kind: 'duplicate' };
  if (hasInstrument) return { kind: 'instrument' };
  if (!employee?.nfcTagUid) return { kind: 'unknown' };
  if (employee.status !== 'ACTIVE') return { kind: 'inactive', status: employee.status };
  return {
    kind: 'employee',
    employee: {
      id: employee.id,
      employeeCode: employee.employeeCode,
      displayName: employee.displayName,
      nfcTagUid: employee.nfcTagUid
    }
  };
}

export async function approveSelfInspectionRecordApproval(
  sessionId: string,
  input: {
    approverEmployeeTagUid: string;
    comment?: string | null;
    clientDeviceId?: string | null;
  }
) {
  const comment = input.comment?.trim() || null;
  const session = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const existing = await tx.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: recordApprovalSessionInclude
    });
    if (!existing || !existing.recordApprovalRequiredAt) {
      throw new ApiError(404, '検査記録承認対象の自主検査セッションが見つかりません');
    }
    assertSelfInspectionSessionActive(existing);
    if (existing.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT') {
      throw new ApiError(409, 'この自主検査は検査員が最終判定して完了してください');
    }
    if (existing.recordApproval) throw new ApiError(409, 'この検査記録は既に承認済みです');
    assertSessionEntryCountWritable(existing);
    const registrationPolicy = await getSelfInspectionRegistrationPolicy(tx);
    const readiness = buildRecordApprovalReadiness(existing, registrationPolicy);
    if (readiness.state === 'input_incomplete') {
      throw new ApiError(409, '測定値が未登録のため承認できません');
    }
    if (readiness.state === 'inspector_measurement_pending') {
      throw new ApiError(409, '検査員の再測定が未完了のため承認できません');
    }
    if (readiness.state === 'registration_incomplete') {
      throw new ApiError(
        409,
        `${requiredRegistrationLabelForPolicy(registrationPolicy)}が未登録のため承認できません`
      );
    }
    const approver = await tx.employee.findFirst({
      where: { nfcTagUid: input.approverEmployeeTagUid.trim() },
      select: { id: true, employeeCode: true, displayName: true, nfcTagUid: true, status: true }
    });
    if (!approver?.nfcTagUid) {
      throw new ApiError(404, '承認者の社員NFCタグが登録されていません');
    }
    if (approver.status !== 'ACTIVE') throw new ApiError(403, '有効な社員のみ承認できます');
    const duplicateInstrumentTag = await tx.measuringInstrumentTag.findUnique({
      where: { rfidTagUid: approver.nfcTagUid },
      select: { id: true }
    });
    if (duplicateInstrumentTag) {
      throw new ApiError(409, '同一タグが社員と計測機器の両方に登録されています');
    }

    const approvedAt = new Date();
    const clientDevice = input.clientDeviceId
      ? await tx.clientDevice.findUnique({
          where: { id: input.clientDeviceId },
          select: { id: true, name: true }
        })
      : null;
    await tx.selfInspectionMeasurementValue.updateMany({
      where: { reviewStatus: 'PENDING', entry: { sessionId } },
      data: {
        reviewStatus: 'APPROVED',
        approvedAt,
        approvedByUserId: approver.id,
        approvedByUsername: approver.displayName,
        approvalComment: comment
      }
    });
    await assertAllEntriesReviewReady(tx, sessionId, existing.template);
    await tx.selfInspectionRecordApproval.create({
      data: {
        sessionId,
        approvedAt,
        approverEmployeeId: approver.id,
        approverEmployeeCodeSnapshot: approver.employeeCode,
        approverEmployeeNameSnapshot: approver.displayName,
        approverEmployeeNfcTagUidSnapshot: approver.nfcTagUid,
        comment,
        clientDeviceId: clientDevice?.id ?? null,
        clientDeviceNameSnapshot: clientDevice?.name ?? null
      }
    });
    if (!existing.completedAt) {
      const finalized = await tx.selfInspectionSession.updateMany({
        where: { id: sessionId, completedAt: null },
        data: { completedAt: approvedAt }
      });
      if (finalized.count === 0) throw new ApiError(409, '自主検査セッションを完了できません');
    }
    const updated = await tx.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        entries: { where: confirmedWhere, select: { entryIndex: true } },
        inspectorEntries: {
          select: {
            entryIndex: true,
            values: {
              select: {
                templateItemId: true,
                inspectorValue: true,
                inspectorJudgementResult: true
              }
            }
          }
        },
        _count: { select: confirmedEntriesCountSelect }
      }
    });
    if (!updated) throw new ApiError(404, '自主検査セッションが見つかりません');
    return updated;
  });
  resetSelfInspectionMachineBoardScheduleRowCaches();
  const [participantSummariesBySessionId, pendingReviewCounts] = await Promise.all([
    loadParticipantSummariesBySessionIds([session.id]),
    loadPendingReviewCountsBySessionIds(prisma, [session.id])
  ]);
  const participantSummary = participantSummariesBySessionId.get(session.id);
  return serializeSessionSummary(
    session,
    participantSummary?.participantEmployeeNames ?? [],
    pendingReviewCounts.get(session.id) ?? 0,
    participantSummary?.participantEmployees ?? []
  );
}
