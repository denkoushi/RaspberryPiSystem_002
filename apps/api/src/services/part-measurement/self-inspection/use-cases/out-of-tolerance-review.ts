import { ApiError } from '../../../../lib/errors.js';
import { prisma } from '../../../../lib/prisma.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../../self-inspection-machine-board-cache-invalidation.js';
import { assertSelfInspectionSessionActive } from '../../self-inspection-invalidation-errors.js';
import { loadParticipantSummariesBySessionIds } from '../../self-inspection-participant-names.query.js';
import { getSelfInspectionRegistrationPolicy } from '../../self-inspection-registration-policy.service.js';
import {
  entrySlotLabelFromKind,
  isSessionCompletionReady,
  resolveTemplateFixedCount,
  serializeEntrySlotKind,
  serializeSelfInspectionMode
} from '../../self-inspection-config.js';
import { partMeasurementTemplateFullInclude } from '../../part-measurement-template-include.js';
import { confirmedEntriesCountSelect, confirmedWhere } from '../entry-persistence-status.js';
import {
  assertAllEntriesHaveRegistration,
  assertAllEntriesReviewReady,
  assertSessionEntryCountWritable,
  lockSessionRow
} from '../mutation-guards.js';
import {
  enrichSessionEntryCountFields,
  resolveStatus,
  serializeProcessGroup,
  sessionForEntryCountPolicy,
  templateConfigFromTemplate
} from '../shared.js';
import {
  loadPendingReviewCountsBySessionIds,
  serializeSessionSummary
} from '../serialization.js';

export async function listPendingSelfInspectionOutOfToleranceReviews() {
  const rows = await prisma.selfInspectionMeasurementValue.findMany({
    where: {
      reviewStatus: 'PENDING',
      entry: {
        ...confirmedWhere,
        session: { invalidatedAt: null, recordApprovalWorkflowStartedAt: null }
      }
    },
    include: {
      templateItem: {
        select: {
          id: true,
          sortOrder: true,
          datumSurface: true,
          measurementPoint: true,
          measurementLabel: true,
          displayMarker: true,
          unit: true,
          lowerLimit: true,
          upperLimit: true
        }
      },
      entry: {
        select: {
          id: true,
          entryIndex: true,
          entrySlotKind: true,
          updatedAt: true,
          session: {
            select: {
              id: true,
              sessionBusinessKey: true,
              templateId: true,
              productNo: true,
              processGroup: true,
              resourceCd: true,
              scheduleRowId: true,
              fseiban: true,
              fhincd: true,
              fhinmei: true,
              machineName: true,
              plannedQuantity: true,
              expectedEntryCount: true,
              startedAt: true,
              completedAt: true,
              updatedAt: true,
              template: {
                select: {
                  name: true,
                  selfInspectionMode: true,
                  selfInspectionFixedCount: true,
                  selfInspectionSampleSize: true
                }
              },
              entries: { where: confirmedWhere, select: { entryIndex: true } },
              _count: { select: confirmedEntriesCountSelect }
            }
          }
        }
      }
    },
    orderBy: [{ updatedAt: 'desc' }]
  });

  const sessions = new Map<
    string,
    {
      session: (typeof rows)[number]['entry']['session'];
      values: Array<{
        id: string;
        entryId: string;
        entryIndex: number;
        entrySlotKind: ReturnType<typeof serializeEntrySlotKind>;
        entrySlotLabel: string;
        templateItemId: string;
        displayMarker: string | null;
        datumSurface: string;
        measurementPoint: string;
        measurementLabel: string;
        unit: string | null;
        value: string | null;
        lowerLimit: string | null;
        upperLimit: string | null;
        outOfToleranceAcknowledgedAt: string | null;
        updatedAt: string;
      }>;
    }
  >();

  for (const row of rows) {
    const sessionId = row.entry.session.id;
    const group = sessions.get(sessionId) ?? { session: row.entry.session, values: [] };
    const slotDto = serializeEntrySlotKind(row.entry.entrySlotKind);
    group.values.push({
      id: row.id,
      entryId: row.entry.id,
      entryIndex: row.entry.entryIndex,
      entrySlotKind: slotDto,
      entrySlotLabel: entrySlotLabelFromKind(slotDto, row.entry.entryIndex),
      templateItemId: row.templateItemId,
      displayMarker: row.templateItem.displayMarker,
      datumSurface: row.templateItem.datumSurface,
      measurementPoint: row.templateItem.measurementPoint,
      measurementLabel: row.templateItem.measurementLabel,
      unit: row.templateItem.unit,
      value: row.value != null ? String(row.value) : null,
      lowerLimit: row.templateItem.lowerLimit != null ? String(row.templateItem.lowerLimit) : null,
      upperLimit: row.templateItem.upperLimit != null ? String(row.templateItem.upperLimit) : null,
      outOfToleranceAcknowledgedAt: row.outOfToleranceAcknowledgedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString()
    });
    sessions.set(sessionId, group);
  }

  return {
    sessions: [...sessions.values()]
      .map((group) => {
        const policy = sessionForEntryCountPolicy(group.session);
        const completedEntryCount = group.session._count.entries;
        const pendingReviewCount = group.values.length;
        const templateConfig = templateConfigFromTemplate(group.session.template);
        return {
          id: group.session.id,
          sessionBusinessKey: group.session.sessionBusinessKey,
          templateId: group.session.templateId,
          templateName: group.session.template.name,
          productNo: group.session.productNo,
          fseiban: group.session.fseiban,
          fhincd: group.session.fhincd,
          fhinmei: group.session.fhinmei,
          processGroup: serializeProcessGroup(group.session.processGroup),
          resourceCd: group.session.resourceCd,
          scheduleRowId: group.session.scheduleRowId,
          machineName: group.session.machineName,
          plannedQuantity: group.session.plannedQuantity,
          expectedEntryCount: group.session.expectedEntryCount,
          ...enrichSessionEntryCountFields({ ...policy, completedEntryCount }),
          completedEntryCount,
          pendingReviewCount,
          selfInspectionMode: serializeSelfInspectionMode(group.session.template.selfInspectionMode),
          selfInspectionFixedCount: resolveTemplateFixedCount(templateConfig),
          selfInspectionSampleSize: resolveTemplateFixedCount(templateConfig),
          status: resolveStatus({
            completedEntryCount,
            hasAnyLotEntry: group.session.entries.length > 0 || completedEntryCount > 0,
            completedAt: group.session.completedAt,
            pendingReviewCount,
            entryIndices: group.session.entries.map((entry) => entry.entryIndex),
            completionPolicy: policy
          }),
          startedAt: group.session.startedAt?.toISOString() ?? null,
          completedAt: group.session.completedAt?.toISOString() ?? null,
          updatedAt: group.session.updatedAt.toISOString(),
          values: group.values.sort((a, b) => {
            if (a.entryIndex !== b.entryIndex) return a.entryIndex - b.entryIndex;
            return a.displayMarker?.localeCompare(b.displayMarker ?? '') ?? 0;
          })
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  };
}

export async function approveSelfInspectionOutOfToleranceReview(
  sessionId: string,
  input: { comment?: string | null; actorUserId: string; actorUsername: string }
) {
  const comment = input.comment?.trim() || null;
  const sessionInclude = {
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
  } as const;
  const session = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const existing = await tx.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: sessionInclude
    });
    if (!existing) throw new ApiError(404, '自主検査セッションが見つかりません');
    assertSelfInspectionSessionActive(existing);
    if (existing.recordApprovalWorkflowStartedAt) {
      throw new ApiError(409, 'この自主検査はキオスクの検査記録承認で承認してください');
    }
    const pendingCount = await tx.selfInspectionMeasurementValue.count({
      where: { reviewStatus: 'PENDING', entry: { sessionId, ...confirmedWhere } }
    });
    if (pendingCount === 0) throw new ApiError(409, '承認待ちの公差外測定値がありません');
    assertSessionEntryCountWritable(existing);
    const registrationPolicy = await getSelfInspectionRegistrationPolicy(tx);
    const templateConfig = templateConfigFromTemplate(existing.template);
    if (
      !isSessionCompletionReady(
        templateConfig,
        existing.plannedQuantity,
        existing.entries.map((entry) => entry.entryIndex)
      )
    ) {
      throw new ApiError(409, '必要件数に達していないため承認完了できません');
    }
    await assertAllEntriesHaveRegistration(tx, sessionId, registrationPolicy);
    const approvedAt = new Date();
    await tx.selfInspectionMeasurementValue.updateMany({
      where: { reviewStatus: 'PENDING', entry: { sessionId } },
      data: {
        reviewStatus: 'APPROVED',
        approvedAt,
        approvedByUserId: input.actorUserId,
        approvedByUsername: input.actorUsername,
        approvalComment: comment
      }
    });
    await assertAllEntriesReviewReady(tx, sessionId, existing.template);
    if (!existing.completedAt) {
      const finalized = await tx.selfInspectionSession.updateMany({
        where: { id: sessionId, completedAt: null },
        data: { completedAt: approvedAt }
      });
      if (finalized.count === 0) throw new ApiError(409, '自主検査セッションを完了できません');
    }
    const updated = await tx.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: sessionInclude
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
