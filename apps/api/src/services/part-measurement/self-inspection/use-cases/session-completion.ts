import { ApiError } from '../../../../lib/errors.js';
import { prisma } from '../../../../lib/prisma.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../../self-inspection-machine-board-cache-invalidation.js';
import { assertSelfInspectionSessionActive } from '../../self-inspection-invalidation-errors.js';
import { loadParticipantSummariesBySessionIds } from '../../self-inspection-participant-names.query.js';
import { getSelfInspectionRegistrationPolicy } from '../../self-inspection-registration-policy.service.js';
import { isSessionCompletionReady } from '../../self-inspection-config.js';
import { partMeasurementTemplateFullInclude } from '../../part-measurement-template-include.js';
import { confirmedEntriesCountSelect, confirmedWhere } from '../entry-persistence-status.js';
import {
  assertAllEntriesHaveRegistration,
  assertAllEntriesReviewReady,
  assertAllInspectorEntriesHaveRegistration,
  assertSessionEntryCountWritable,
  lockSessionRow
} from '../mutation-guards.js';
import {
  buildInspectorMeasurementCompletion,
  templateConfigFromTemplate
} from '../shared.js';
import {
  loadPendingReviewCountsBySessionIds,
  serializeSessionSummary
} from '../serialization.js';

export async function completeSelfInspectionSession(sessionId: string) {
  const sessionInclude = {
    template: { include: partMeasurementTemplateFullInclude },
    entries: {
      where: confirmedWhere,
      select: { entryIndex: true, persistenceStatus: true }
    },
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
    recordApproval: { select: { id: true } },
    _count: { select: confirmedEntriesCountSelect }
  } as const;

  const session = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const existing = await tx.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: sessionInclude
    });
    if (!existing) throw new ApiError(404, '自主検査セッションが見つかりません');
    assertSelfInspectionSessionActive(existing);
    if (existing.completedAt) return existing;
    const isInspectorFinalization = existing.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT';
    if (
      !isInspectorFinalization &&
      existing.recordApprovalRequiredAt &&
      !existing.recordApproval
    ) {
      throw new ApiError(409, '検査記録承認が未完了のため完了できません');
    }
    assertSessionEntryCountWritable(existing);
    const registrationPolicy = await getSelfInspectionRegistrationPolicy(tx);
    const templateConfig = templateConfigFromTemplate(existing.template);
    const entryRows = await tx.selfInspectionLotEntry.findMany({
      where: { sessionId, ...confirmedWhere },
      select: { entryIndex: true }
    });
    if (
      !isSessionCompletionReady(
        templateConfig,
        existing.plannedQuantity,
        entryRows.map((row) => row.entryIndex)
      )
    ) {
      throw new ApiError(409, '必要件数に達していないため完了できません');
    }
    await assertAllEntriesHaveRegistration(tx, sessionId, registrationPolicy);
    if (isInspectorFinalization) {
      const inspectorCompletion = buildInspectorMeasurementCompletion({
        inspectorRemeasurementRequiredAt: existing.inspectorRemeasurementRequiredAt,
        recordApproval: existing.recordApproval,
        completedAt: existing.completedAt,
        template: {
          ...templateConfig,
          itemIds: existing.template.items.map((item) => item.id)
        },
        plannedQuantity: existing.plannedQuantity,
        operatorEntries: existing.entries,
        inspectorEntries: existing.inspectorEntries
      });
      if (inspectorCompletion.state !== 'complete') {
        throw new ApiError(409, '検査員の再測定が未完了のため完了できません');
      }
      await assertAllInspectorEntriesHaveRegistration(tx, sessionId, registrationPolicy);
      const unjudgedCount = await tx.selfInspectionMeasurementValue.count({
        where: {
          reviewStatus: 'PENDING',
          finalReviewStatus: null,
          entry: { sessionId, ...confirmedWhere }
        }
      });
      if (unjudgedCount > 0) {
        throw new ApiError(409, '測定者側で公差外となった全測定点を最終判定してください');
      }
    } else {
      await assertAllEntriesReviewReady(tx, sessionId, existing.template);
    }
    const finalized = await tx.selfInspectionSession.updateMany({
      where: { id: sessionId, completedAt: null },
      data: { completedAt: new Date() }
    });
    if (finalized.count === 0) {
      const current = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: sessionInclude
      });
      if (current?.completedAt) return current;
      throw new ApiError(409, '自主検査セッションを完了できません');
    }
    const completed = await tx.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: sessionInclude
    });
    if (!completed) throw new ApiError(404, '自主検査セッションが見つかりません');
    return completed;
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
