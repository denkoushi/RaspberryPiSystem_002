import { Prisma } from '@prisma/client';
import type { PartMeasurementProcessGroup } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { resolveProductionSchedulePlannedQuantity } from '../production-schedule/self-inspection-schedule-eligibility.js';
import { verifyProductionScheduleRowOrThrow } from '../production-schedule/verify-production-schedule-row.js';
import { MeasuringInstrumentLoanEventService } from '../measuring-instruments/measuring-instrument-loan-event.service.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from './self-inspection-machine-board-cache-invalidation.js';
import { markSelfInspectionRecordApprovalRequiredAfterMeasurementSave } from './self-inspection-record-approval-saved-gate.js';
import {
  collectParticipantEmployeeNames,
  collectParticipantEmployees
} from './self-inspection-participant-names.js';
import { loadParticipantSummariesBySessionIds } from './self-inspection-participant-names.query.js';
import {
  getSelfInspectionRegistrationPolicy,
  isSelfInspectionLotEntryRegistrationCompleteForPolicy
} from './self-inspection-registration-policy.service.js';

import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';
import {
  assertEntryIndexAllowed,
  entrySlotLabelFromKind,
  inferEntrySlotKindForIndex,
  isFullSelfInspectionPlannedQuantityWithinLimit,
  isSessionCompletionReady,
  listRequiredEntrySlots,
  resolveTemplateFixedCount,
  serializeEntrySlotKind,
  serializeSelfInspectionMode,
  tryResolveExpectedEntryCount,
  SELF_INSPECTION_FULL_MODE_PLANNED_QUANTITY_LIMIT_MESSAGE,
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT
} from './self-inspection-config.js';
import {
  assertSelfInspectionResetConfirmation,
  buildRestartPayloadFromSessionSnapshot,
  buildSessionResetSnapshot,
  hasInspectionDrawingTemplateForReset,
  resolveExpectedEntryCountForReset,
  SELF_INSPECTION_RESET_ACTION_TYPE,
  templateConfigFromTemplateForReset
} from './self-inspection-reset-preflight.js';

import {
  assertEntryUnmodifiedSince,
  buildInspectorMeasurementCompletion,
  buildSessionBusinessKey,
  enrichSessionEntryCountFields,
  hasInspectionDrawingTemplate,
  normalizeText,
  resolveExpectedEntryCount,
  resolveStatus,
  serializeProcessGroup,
  sessionForEntryCountPolicy,
  templateConfigFromTemplate,
  type SelfInspectionMeasurementPayloadValue,
  type SelfInspectionStatusDto
} from './self-inspection/shared.js';
import {
  buildRecordApprovalReadiness,
  listSessionsSummaryInclude,
  loadPendingReviewCountsBySessionIds,
  recordApprovalSessionInclude,
  requiredRegistrationLabelForPolicy,
  serializeInspectorEntry,
  serializeInspectorEntryMeta,
  serializeDecisionWorkflow,
  serializeLotEntry,
  serializeLotEntryMeta,
  serializeRecordApproval,
  serializeRecordApprovalEntryDetail,
  serializeRecordApprovalSessionListItem,
  serializeResetNewSession,
  serializeSessionSummary,
  serializeSessionSummaryWithAggregatedParticipantNames,
  type SelfInspectionApproverResolveResult,
  type SelfInspectionRecordApprovalState
} from './self-inspection/serialization.js';
import {
  assertAllEntriesHaveRegistration,
  assertAllEntriesReviewReady,
  assertAllInspectorEntriesHaveRegistration,
  assertInspectorRemeasurementNotStarted,
  assertLotEntryValuesMatchPayload,
  assertSessionEntryCountWritable,
  loadSessionForMutation,
  lockSessionRow,
  validateMeasurementPayload
} from './self-inspection/mutation-guards.js';
import { validateDraftMeasurementPayload } from './self-inspection/entry-draft-validation.js';
import {
  confirmedEntriesCountSelect,
  confirmedWhere,
  isConfirmed,
  SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED,
  SELF_INSPECTION_ENTRY_PERSISTENCE_DRAFT
} from './self-inspection/entry-persistence-status.js';
import { resolveDraftUpsertExistingDecision } from './self-inspection/entry-draft-upsert-guard.js';
import {
  buildRegistrationBackfillData,
  entryRegistrationFromRow,
  resolveEntryActor,
  resolveMeasuringInstrumentByTag,
  resolveRegistrationForCreateEntry,
  resolveRegistrationPatchForUpdate
} from './self-inspection/entry-registration.js';
import { assertSelfInspectionEntryRegistrationTagUids } from './self-inspection-registration-tag-validation.js';
import { saveInspectorEntry, saveInspectorJudgements } from './self-inspection/inspector-entry.js';
import {
  recordInspectorInstrumentPreUseInspection as recordInspectorInstrumentPreUseInspectionOp,
  recordInstrumentPreUseInspection as recordInstrumentPreUseInspectionOp
} from './self-inspection/instrument-pre-use-inspection.js';
import {
  buildLeaderboardDecorations as buildLeaderboardDecorationsOp,
  type SelfInspectionDecorationCache
} from './self-inspection/decoration.js';

export const LIST_SESSIONS_MAX = 200;

export {
  isFullSelfInspectionPlannedQuantityWithinLimit,
  SELF_INSPECTION_FULL_MODE_PLANNED_QUANTITY_LIMIT_MESSAGE,
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT,
  tryResolveExpectedEntryCount
};

export {
  createSelfInspectionDecorationCache,
  ensureSelfInspectionSessionsInCache,
  ensureSelfInspectionTemplatesForRows,
  pickSessionForScheduleRow
} from './self-inspection/decoration.js';
export type {
  SelfInspectionDecorationCache,
  SelfInspectionSessionForDecoration
} from './self-inspection/decoration.js';
export {
  resolveLegacyFullSelfInspectionBlockedReason,
  resolveRequiredEntryCountForCompletion
} from './self-inspection/shared.js';
export type {
  SelfInspectionApproverResolveResult,
  SelfInspectionRecordApprovalState
} from './self-inspection/serialization.js';

export class SelfInspectionService {
  private readonly loanEventService = new MeasuringInstrumentLoanEventService();

  async resolveOrCreateSession(input: {
    templateId: string;
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    scheduleRowId: string;
    fseiban: string;
    fhincd?: string | null;
    fhinmei?: string | null;
    machineName?: string | null;
    clientDeviceId?: string | null;
  }) {
    const productNo = normalizeText(input.productNo);
    const resourceCd = normalizeText(input.resourceCd);
    if (!productNo || !resourceCd) {
      throw new ApiError(400, '製造order と資源CDが必要です');
    }
    const template = await prisma.partMeasurementTemplate.findFirst({
      where: {
        id: input.templateId,
        isActive: true,
        processGroup: input.processGroup,
        resourceCd,
        templateScope: 'THREE_KEY'
      },
      include: partMeasurementTemplateFullInclude
    });
    if (!template) {
      throw new ApiError(404, '自主検査テンプレートが見つかりません');
    }
    if (!hasInspectionDrawingTemplate(template)) {
      throw new ApiError(409, '自主検査対象の検査図面テンプレートではありません');
    }
    const fhincdInput = normalizeText(input.fhincd);
    const fhincd = fhincdInput || template.fhincd;
    if (fhincdInput && fhincdInput !== normalizeText(template.fhincd)) {
      throw new ApiError(400, '品番がテンプレートと一致しません');
    }
    const fhinmei = normalizeText(input.fhinmei);
    if (!fhincd || !fhinmei) {
      throw new ApiError(400, '品番と品名が必要です');
    }
    const scheduleRowId = normalizeText(input.scheduleRowId);
    if (!scheduleRowId) {
      throw new ApiError(400, '日程行IDが必要です');
    }
    const fseiban = normalizeText(input.fseiban);
    if (!fseiban) {
      throw new ApiError(400, '製番が必要です');
    }
    await verifyProductionScheduleRowOrThrow(scheduleRowId, {
      productNo,
      fseiban,
      fhincd,
      resourceCd
    });
    const supplement = await prisma.productionScheduleOrderSupplement.findFirst({
      where: {
        csvDashboardRowId: scheduleRowId,
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
      },
      select: { plannedQuantity: true }
    });
    const plannedQuantity = resolveProductionSchedulePlannedQuantity(supplement?.plannedQuantity ?? null);
    if (plannedQuantity == null) {
      throw new ApiError(400, '指示数が補助データにないため自主検査を開始できません');
    }
    const expectedEntryCount = resolveExpectedEntryCount(
      templateConfigFromTemplate(template),
      plannedQuantity
    );
    const sessionBusinessKey = buildSessionBusinessKey({
      productNo,
      processGroup: input.processGroup,
      resourceCd,
      scheduleRowId
    });

    const sessionInclude = {
      template: { include: partMeasurementTemplateFullInclude },
      entries: { where: confirmedWhere, select: { entryIndex: true } },
      inspectorEntries: {
        select: {
          entryIndex: true,
          values: {
            select: {
              templateItemId: true,
              inspectorValue: true
            }
          }
        }
      },
      recordApproval: { select: { id: true } },
      _count: { select: confirmedEntriesCountSelect }
    } as const;

    const session = await prisma.selfInspectionSession.upsert({
      where: { sessionBusinessKey },
      create: {
        sessionBusinessKey,
        templateId: template.id,
        productNo,
        processGroup: input.processGroup,
        resourceCd,
        scheduleRowId,
        fseiban,
        fhincd,
        fhinmei,
        machineName: normalizeText(input.machineName) || null,
        plannedQuantity,
        expectedEntryCount,
        clientDeviceId: input.clientDeviceId ?? null,
        startedAt: new Date(),
        decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
        recordApprovalWorkflowStartedAt: new Date()
      },
      update: {},
      include: sessionInclude
    });

    return serializeSessionSummaryWithAggregatedParticipantNames(session);
  }

  async listSessions(query: {
    productNo?: string;
    resourceCd?: string;
    processGroup?: PartMeasurementProcessGroup;
    status?: SelfInspectionStatusDto;
  }) {
    const productNo = normalizeText(query.productNo);
    const resourceCd = normalizeText(query.resourceCd);
    if (!productNo && !resourceCd && query.status !== 'in_progress' && query.status !== 'review_pending') {
      throw new ApiError(400, '製造order または資源CDのいずれかで絞り込んでください');
    }
    const rows = await prisma.selfInspectionSession.findMany({
      where: {
        ...(productNo ? { productNo: { contains: productNo, mode: 'insensitive' } } : {}),
        ...(resourceCd ? { resourceCd: { equals: resourceCd, mode: 'insensitive' } } : {}),
        ...(query.processGroup ? { processGroup: query.processGroup } : {}),
        ...(query.status === 'not_started' ? { entries: { none: {} } } : {}),
        ...(query.status === 'in_progress'
          ? { completedAt: null, entries: { some: {} } }
          : {}),
        ...(query.status === 'review_pending'
          ? {
              completedAt: null,
              entries: { some: { values: { some: { reviewStatus: 'PENDING' } } } }
            }
          : {}),
        ...(query.status === 'completed' ? { completedAt: { not: null } } : {})
      },
      include: listSessionsSummaryInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: LIST_SESSIONS_MAX + 1
    });
    const truncated = rows.length > LIST_SESSIONS_MAX;
    const boundedRows = truncated ? rows.slice(0, LIST_SESSIONS_MAX) : rows;
    const sessionIds = boundedRows.map((row) => row.id);
    const [participantSummariesBySessionId, pendingReviewCounts] = await Promise.all([
      loadParticipantSummariesBySessionIds(sessionIds),
      loadPendingReviewCountsBySessionIds(prisma, sessionIds)
    ]);
    const summaries = boundedRows.map((row) => {
      const participantSummary = participantSummariesBySessionId.get(row.id);
      return serializeSessionSummary(
        row,
        participantSummary?.participantEmployeeNames ?? [],
        pendingReviewCounts.get(row.id) ?? 0,
        participantSummary?.participantEmployees ?? []
      );
    });
    const sessions =
      query.status === 'in_progress'
        ? summaries.filter((row) => row.status === 'in_progress')
      : query.status === 'completed'
        ? summaries.filter((row) => row.status === 'completed')
        : query.status === 'review_pending'
          ? summaries.filter((row) => row.status === 'review_pending')
        : summaries;
    return {
      sessions,
      listLimit: LIST_SESSIONS_MAX,
      truncated
    };
  }

  async listRecordApprovalSessions(query: {
    productNo?: string;
    resourceCd?: string;
    processGroup?: PartMeasurementProcessGroup;
    state?: 'active' | SelfInspectionRecordApprovalState;
  }) {
    const productNo = normalizeText(query.productNo);
    const resourceCd = normalizeText(query.resourceCd);
    const state = query.state ?? 'active';
    const rows = await prisma.selfInspectionSession.findMany({
      where: {
        recordApprovalRequiredAt: { not: null },
        OR: [
          { decisionWorkflow: null },
          { decisionWorkflow: 'LEGACY_RECORD_APPROVAL' }
        ],
        ...(productNo ? { productNo: { contains: productNo, mode: 'insensitive' } } : {}),
        ...(resourceCd ? { resourceCd: { equals: resourceCd, mode: 'insensitive' } } : {}),
        ...(query.processGroup ? { processGroup: query.processGroup } : {}),
        ...(state === 'approved'
          ? { recordApproval: { isNot: null } }
          : { completedAt: null, recordApproval: { is: null } })
      },
      include: recordApprovalSessionInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: LIST_SESSIONS_MAX + 1
    });
    const truncated = rows.length > LIST_SESSIONS_MAX;
    const boundedRows = truncated ? rows.slice(0, LIST_SESSIONS_MAX) : rows;
    const registrationPolicy = await getSelfInspectionRegistrationPolicy();
    const sessions = boundedRows
      .map((row) => serializeRecordApprovalSessionListItem(row, registrationPolicy))
      .filter((row) => state === 'active' || row.recordApprovalState === state);
    return {
      sessions,
      listLimit: LIST_SESSIONS_MAX,
      truncated
    };
  }

  async getRecordApprovalSessionDetail(sessionId: string) {
    const session = await prisma.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: recordApprovalSessionInclude
    });
    if (
      !session ||
      !session.recordApprovalRequiredAt ||
      session.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT'
    ) {
      throw new ApiError(404, '検査記録承認対象の自主検査セッションが見つかりません');
    }
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

  async resolveRecordApprovalApprover(rawUid: string): Promise<SelfInspectionApproverResolveResult> {
    const uid = rawUid.trim();
    if (!uid) {
      return { kind: 'unknown' };
    }
    const [employee, instrumentTag] = await Promise.all([
      prisma.employee.findFirst({
        where: { nfcTagUid: uid },
        select: {
          id: true,
          employeeCode: true,
          displayName: true,
          nfcTagUid: true,
          status: true
        }
      }),
      prisma.measuringInstrumentTag.findUnique({
        where: { rfidTagUid: uid },
        select: { id: true }
      })
    ]);
    const hasEmployee = Boolean(employee?.nfcTagUid);
    const hasInstrument = Boolean(instrumentTag);
    if (hasEmployee && hasInstrument) {
      return { kind: 'duplicate' };
    }
    if (hasInstrument) {
      return { kind: 'instrument' };
    }
    if (!employee?.nfcTagUid) {
      return { kind: 'unknown' };
    }
    if (employee.status !== 'ACTIVE') {
      return { kind: 'inactive', status: employee.status };
    }
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

  async approveRecordApproval(sessionId: string, input: {
    approverEmployeeTagUid: string;
    comment?: string | null;
    clientDeviceId?: string | null;
  }) {
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
      if (existing.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT') {
        throw new ApiError(409, 'この自主検査は検査員が最終判定して完了してください');
      }
      if (existing.recordApproval) {
        throw new ApiError(409, 'この検査記録は既に承認済みです');
      }
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
        select: {
          id: true,
          employeeCode: true,
          displayName: true,
          nfcTagUid: true,
          status: true
        }
      });
      if (!approver?.nfcTagUid) {
        throw new ApiError(404, '承認者の社員NFCタグが登録されていません');
      }
      if (approver.status !== 'ACTIVE') {
        throw new ApiError(403, '有効な社員のみ承認できます');
      }
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
        where: {
          reviewStatus: 'PENDING',
          entry: { sessionId }
        },
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
        if (finalized.count === 0) {
          throw new ApiError(409, '自主検査セッションを完了できません');
        }
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
                  inspectorValue: true
                }
              }
            }
          },
          _count: { select: confirmedEntriesCountSelect }
        }
      });
      if (!updated) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
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

  async getSessionDetail(sessionId: string, options?: { entryIndex?: number }) {
    const entryIndex =
      options?.entryIndex != null && Number.isFinite(options.entryIndex)
        ? Math.floor(options.entryIndex)
        : null;

    const session = await prisma.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        entries: {
          orderBy: { entryIndex: 'asc' },
          select: {
            id: true,
            entryIndex: true,
            entrySlotKind: true,
            persistenceStatus: true,
            createdByEmployeeId: true,
            createdByEmployeeNameSnapshot: true,
            measuringInstrumentId: true,
            measuringInstrumentManagementNumberSnapshot: true,
            measuringInstrumentNameSnapshot: true,
            measuringInstrumentTagUidSnapshot: true,
            instrumentUsages: {
              orderBy: { preUseInspectedAt: 'asc' },
              select: {
                id: true,
                measuringInstrumentId: true,
                loanId: true,
                measuringInstrumentManagementNumberSnapshot: true,
                measuringInstrumentNameSnapshot: true,
                measuringInstrumentTagUidSnapshot: true,
                preUseInspectedAt: true,
                createdAt: true,
                updatedAt: true
              }
            },
            createdAt: true,
            updatedAt: true
          }
        },
        inspectorEntries: {
          select: {
            entryIndex: true,
            values: {
              select: {
                templateItemId: true,
                inspectorValue: true
              }
            }
          }
        },
        recordApproval: true,
        _count: { select: confirmedEntriesCountSelect }
      }
    });
    if (!session) {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }

    const focusedEntryRow =
      entryIndex != null
        ? await prisma.selfInspectionLotEntry.findUnique({
            where: {
              sessionId_entryIndex: {
                sessionId,
                entryIndex
              }
            },
            include: {
              instrumentUsages: {
                orderBy: { preUseInspectedAt: 'asc' },
                select: {
                  id: true,
                  measuringInstrumentId: true,
                  loanId: true,
                  measuringInstrumentManagementNumberSnapshot: true,
                  measuringInstrumentNameSnapshot: true,
                  measuringInstrumentTagUidSnapshot: true,
                  preUseInspectedAt: true,
                  createdAt: true,
                  updatedAt: true
                }
              },
              values: {
                orderBy: { createdAt: 'asc' }
              }
            }
          })
        : null;

    const policy = sessionForEntryCountPolicy(session);
    const completedEntryCount = session._count.entries;
    const templateConfig = templateConfigFromTemplate(session.template);
    const pendingReviewCounts = await loadPendingReviewCountsBySessionIds(prisma, [session.id]);
    const pendingReviewCount = pendingReviewCounts.get(session.id) ?? 0;
    const confirmedEntryIndices = session.entries
      .filter((entry) => isConfirmed(entry.persistenceStatus))
      .map((entry) => entry.entryIndex);
    const inspectorMeasurement = buildInspectorMeasurementCompletion({
      inspectorRemeasurementRequiredAt: session.inspectorRemeasurementRequiredAt,
      recordApproval: session.recordApproval,
      completedAt: session.completedAt,
      template: {
        ...templateConfig,
        itemIds: session.template.items.map((item) => item.id)
      },
      plannedQuantity: session.plannedQuantity,
      inspectorEntries: session.inspectorEntries
    });
    return {
      id: session.id,
      sessionBusinessKey: session.sessionBusinessKey,
      templateId: session.templateId,
      templateName: session.template.name,
      productNo: session.productNo,
      fseiban: session.fseiban,
      fhincd: session.fhincd,
      fhinmei: session.fhinmei,
      processGroup: serializeProcessGroup(session.processGroup),
      resourceCd: session.resourceCd,
      scheduleRowId: session.scheduleRowId,
      machineName: session.machineName,
      plannedQuantity: session.plannedQuantity,
      expectedEntryCount: session.expectedEntryCount,
      ...enrichSessionEntryCountFields({ ...policy, completedEntryCount }),
      completedEntryCount,
      pendingReviewCount,
      participantEmployeeNames: collectParticipantEmployeeNames(session.entries),
      participantEmployees: collectParticipantEmployees(session.entries),
      selfInspectionMode: serializeSelfInspectionMode(session.template.selfInspectionMode),
      selfInspectionFixedCount: resolveTemplateFixedCount(templateConfig),
      selfInspectionSampleSize: resolveTemplateFixedCount(templateConfig),
      status: resolveStatus({
        completedEntryCount,
        hasAnyLotEntry: session.entries.length > 0,
        completedAt: session.completedAt,
        pendingReviewCount,
        entryIndices: confirmedEntryIndices,
        completionPolicy: policy
      }),
      startedAt: session.startedAt?.toISOString() ?? null,
      completedAt: session.completedAt?.toISOString() ?? null,
      recordApprovalRequiredAt: session.recordApprovalRequiredAt?.toISOString() ?? null,
      recordApprovalWorkflowStartedAt: session.recordApprovalWorkflowStartedAt?.toISOString() ?? null,
      decisionWorkflow: serializeDecisionWorkflow(session.decisionWorkflow),
      inspectorRemeasurementRequiredAt: session.inspectorRemeasurementRequiredAt?.toISOString() ?? null,
      inspectorMeasurementState: inspectorMeasurement.state,
      inspectorRequiredEntryCount: inspectorMeasurement.requiredEntryCount,
      inspectorCompletedRequiredEntryCount: inspectorMeasurement.completedRequiredEntryCount,
      inspectorMissingRequiredEntryCount: inspectorMeasurement.missingRequiredEntryCount,
      inspectorIncompleteValueEntryCount: inspectorMeasurement.incompleteValueEntryCount,
      recordApproval: serializeRecordApproval(session.recordApproval),
      updatedAt: session.updatedAt.toISOString(),
      template: session.template,
      entries: session.entries.map((entry) => serializeLotEntryMeta(entry)),
      focusedEntry: focusedEntryRow ? serializeLotEntry(focusedEntryRow) : null
    };
  }

  async getInspectorMeasurementSessionDetail(sessionId: string, options?: { entryIndex?: number }) {
    const entryIndex =
      options?.entryIndex != null && Number.isFinite(options.entryIndex)
        ? Math.floor(options.entryIndex)
        : null;

    const session = await prisma.selfInspectionSession.findUnique({
      where: { id: sessionId },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        entries: {
          orderBy: { entryIndex: 'asc' },
          select: {
            id: true,
            entryIndex: true,
            entrySlotKind: true,
            persistenceStatus: true,
            createdByEmployeeId: true,
            createdByEmployeeNameSnapshot: true,
            measuringInstrumentId: true,
            measuringInstrumentManagementNumberSnapshot: true,
            measuringInstrumentNameSnapshot: true,
            measuringInstrumentTagUidSnapshot: true,
            instrumentUsages: {
              orderBy: { preUseInspectedAt: 'asc' },
              select: {
                id: true,
                measuringInstrumentId: true,
                loanId: true,
                measuringInstrumentManagementNumberSnapshot: true,
                measuringInstrumentNameSnapshot: true,
                measuringInstrumentTagUidSnapshot: true,
                preUseInspectedAt: true,
                createdAt: true,
                updatedAt: true
              }
            },
            createdAt: true,
            updatedAt: true
          }
        },
        inspectorEntries: {
          orderBy: { entryIndex: 'asc' },
          include: {
            instrumentUsages: {
              orderBy: { preUseInspectedAt: 'asc' }
            },
            values: {
              orderBy: { createdAt: 'asc' },
              include: {
                operatorMeasurementValue: {
                  select: { reviewStatus: true, finalReviewStatus: true }
                }
              }
            }
          }
        },
        recordApproval: true,
        _count: { select: confirmedEntriesCountSelect }
      }
    });
    if (!session || !session.recordApprovalRequiredAt || !session.inspectorRemeasurementRequiredAt) {
      throw new ApiError(404, '検査員再測定対象の自主検査セッションが見つかりません');
    }

    const focusedEntryRow =
      entryIndex != null
        ? await prisma.selfInspectionInspectorEntry.findUnique({
            where: {
              sessionId_entryIndex: {
                sessionId,
                entryIndex
              }
            },
            include: {
              instrumentUsages: {
                orderBy: { preUseInspectedAt: 'asc' }
              },
              values: {
                orderBy: { createdAt: 'asc' },
                include: {
                  operatorMeasurementValue: {
                    select: { reviewStatus: true, finalReviewStatus: true }
                  }
                }
              }
            }
          })
        : null;

    const policy = sessionForEntryCountPolicy(session);
    const completedEntryCount = session._count.entries;
    const templateConfig = templateConfigFromTemplate(session.template);
    const pendingReviewCounts = await loadPendingReviewCountsBySessionIds(prisma, [session.id]);
    const pendingReviewCount = pendingReviewCounts.get(session.id) ?? 0;
    const confirmedEntryIndices = session.entries
      .filter((entry) => isConfirmed(entry.persistenceStatus))
      .map((entry) => entry.entryIndex);
    const inspectorMeasurement = buildInspectorMeasurementCompletion({
      inspectorRemeasurementRequiredAt: session.inspectorRemeasurementRequiredAt,
      recordApproval: session.recordApproval,
      completedAt: session.completedAt,
      template: {
        ...templateConfig,
        itemIds: session.template.items.map((item) => item.id)
      },
      plannedQuantity: session.plannedQuantity,
      inspectorEntries: session.inspectorEntries
    });

    return {
      id: session.id,
      sessionBusinessKey: session.sessionBusinessKey,
      templateId: session.templateId,
      templateName: session.template.name,
      productNo: session.productNo,
      fseiban: session.fseiban,
      fhincd: session.fhincd,
      fhinmei: session.fhinmei,
      processGroup: serializeProcessGroup(session.processGroup),
      resourceCd: session.resourceCd,
      scheduleRowId: session.scheduleRowId,
      machineName: session.machineName,
      plannedQuantity: session.plannedQuantity,
      expectedEntryCount: session.expectedEntryCount,
      ...enrichSessionEntryCountFields({ ...policy, completedEntryCount }),
      completedEntryCount,
      pendingReviewCount,
      participantEmployeeNames: collectParticipantEmployeeNames(session.entries),
      participantEmployees: collectParticipantEmployees(session.entries),
      selfInspectionMode: serializeSelfInspectionMode(session.template.selfInspectionMode),
      selfInspectionFixedCount: resolveTemplateFixedCount(templateConfig),
      selfInspectionSampleSize: resolveTemplateFixedCount(templateConfig),
      status: resolveStatus({
        completedEntryCount,
        hasAnyLotEntry: session.entries.length > 0,
        completedAt: session.completedAt,
        pendingReviewCount,
        entryIndices: confirmedEntryIndices,
        completionPolicy: policy
      }),
      startedAt: session.startedAt?.toISOString() ?? null,
      completedAt: session.completedAt?.toISOString() ?? null,
      recordApprovalRequiredAt: session.recordApprovalRequiredAt?.toISOString() ?? null,
      recordApprovalWorkflowStartedAt: session.recordApprovalWorkflowStartedAt?.toISOString() ?? null,
      decisionWorkflow: serializeDecisionWorkflow(session.decisionWorkflow),
      inspectorRemeasurementRequiredAt: session.inspectorRemeasurementRequiredAt?.toISOString() ?? null,
      inspectorMeasurementState: inspectorMeasurement.state,
      inspectorRequiredEntryCount: inspectorMeasurement.requiredEntryCount,
      inspectorCompletedRequiredEntryCount: inspectorMeasurement.completedRequiredEntryCount,
      inspectorMissingRequiredEntryCount: inspectorMeasurement.missingRequiredEntryCount,
      inspectorIncompleteValueEntryCount: inspectorMeasurement.incompleteValueEntryCount,
      recordApproval: serializeRecordApproval(session.recordApproval),
      updatedAt: session.updatedAt.toISOString(),
      template: session.template,
      entries: session.inspectorEntries.map((entry) => serializeInspectorEntryMeta(entry)),
      operatorEntries: session.entries.map((entry) => serializeLotEntryMeta(entry)),
      focusedEntry: focusedEntryRow ? serializeInspectorEntry(focusedEntryRow) : null
    };
  }

  async createInspectorEntry(sessionId: string, input: {
    entryIndex: number;
    values: SelfInspectionMeasurementPayloadValue[];
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    clientDeviceId?: string | null;
  }) {
    return saveInspectorEntry(sessionId, input);
  }

  async updateInspectorEntry(
    sessionId: string,
    entryId: string,
    input: {
      entryIndex: number;
      ifUnmodifiedSince: string;
      values: SelfInspectionMeasurementPayloadValue[];
      employeeTagUid?: string | null;
      measuringInstrumentTagUid?: string | null;
      clientDeviceId?: string | null;
    }
  ) {
    return saveInspectorEntry(sessionId, input, {
      entryId,
      ifUnmodifiedSince: input.ifUnmodifiedSince
    });
  }

  async saveInspectorJudgements(
    sessionId: string,
    entryId: string,
    input: { judgements: Array<{ templateItemId: string; judgementStatus: 'FINAL_OK' | 'FINAL_NG' }> }
  ) {
    return saveInspectorJudgements(sessionId, entryId, input);
  }

  async recordInspectorInstrumentPreUseInspection(
    sessionId: string,
    entryIndexInput: number,
    input: {
      instrumentTagUid: string;
      employeeTagUid: string;
      clientDeviceId?: string | null;
    }
  ) {
    return recordInspectorInstrumentPreUseInspectionOp(
      this.loanEventService,
      sessionId,
      entryIndexInput,
      input
    );
  }

  async recordInstrumentPreUseInspection(
    sessionId: string,
    entryIndexInput: number,
    input: {
      instrumentTagUid: string;
      employeeTagUid: string;
      clientDeviceId?: string | null;
    }
  ) {
    return recordInstrumentPreUseInspectionOp(
      this.loanEventService,
      sessionId,
      entryIndexInput,
      input
    );
  }

  async createEntry(sessionId: string, input: {
    entryIndex: number;
    values: SelfInspectionMeasurementPayloadValue[];
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    createdByEmployeeId?: string | null;
    createdByEmployeeNameSnapshot?: string | null;
  }) {
    const entryIndex = Math.floor(input.entryIndex);
    const result = await prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);
      const session = await loadSessionForMutation(tx, sessionId);
      assertSessionEntryCountWritable(session);
      await assertInspectorRemeasurementNotStarted(tx, sessionId);
      const registrationPolicy = await getSelfInspectionRegistrationPolicy(tx);
      const templateConfig = templateConfigFromTemplate(session.template);
      assertEntryIndexAllowed(templateConfig, session.plannedQuantity, entryIndex);
      const slotKind = inferEntrySlotKindForIndex(
        templateConfig,
        session.plannedQuantity,
        entryIndex
      );

      const existingAtIndex = await tx.selfInspectionLotEntry.findUnique({
        where: {
          sessionId_entryIndex: {
            sessionId,
            entryIndex
          }
        },
        include: { values: true, instrumentUsages: true }
      });
      const values = validateMeasurementPayload(
        session.template,
        input.values,
        existingAtIndex?.values ?? []
      );
      if (existingAtIndex) {
        assertLotEntryValuesMatchPayload(existingAtIndex, values);
        const registration = await resolveRegistrationForCreateEntry(
          entryRegistrationFromRow(existingAtIndex),
          input,
          registrationPolicy
        );
        const backfillData = buildRegistrationBackfillData(existingAtIndex, registration);
        if (backfillData || !isConfirmed(existingAtIndex.persistenceStatus)) {
          const backfilled = await tx.selfInspectionLotEntry.update({
            where: { id: existingAtIndex.id },
            data: {
              ...(backfillData ?? {}),
              persistenceStatus: SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED
            },
            include: { values: true, instrumentUsages: true }
          });
          await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
          return serializeLotEntry(backfilled);
        }
        if (!isSelfInspectionLotEntryRegistrationCompleteForPolicy(existingAtIndex, registrationPolicy)) {
          throw new ApiError(
            400,
            `${requiredRegistrationLabelForPolicy(registrationPolicy)}のNFCタグが必要です`
          );
        }
        await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
        return serializeLotEntry(existingAtIndex);
      }

      const registration = await resolveRegistrationForCreateEntry(null, input, registrationPolicy);

      try {
        const entry = await tx.selfInspectionLotEntry.create({
          data: {
            sessionId,
            entryIndex,
            entrySlotKind: slotKind,
            persistenceStatus: SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED,
            createdByEmployeeId: registration.createdByEmployeeId,
            createdByEmployeeNameSnapshot: registration.createdByEmployeeNameSnapshot,
            measuringInstrumentId: registration.measuringInstrumentId,
            measuringInstrumentManagementNumberSnapshot:
              registration.measuringInstrumentManagementNumberSnapshot,
            measuringInstrumentNameSnapshot: registration.measuringInstrumentNameSnapshot,
            measuringInstrumentTagUidSnapshot: registration.measuringInstrumentTagUidSnapshot,
            values: {
              create: values
            }
          },
          include: {
            values: true,
            instrumentUsages: true
          }
        });
        await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
        return serializeLotEntry(entry);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        const raced = await tx.selfInspectionLotEntry.findUnique({
          where: {
            sessionId_entryIndex: {
              sessionId,
              entryIndex
            }
          },
          include: { values: true, instrumentUsages: true }
        });
        if (!raced) {
          throw error;
        }
        assertLotEntryValuesMatchPayload(raced, values);
        const racedRegistration = await resolveRegistrationForCreateEntry(
          entryRegistrationFromRow(raced),
          input,
          registrationPolicy
        );
        const backfillData = buildRegistrationBackfillData(raced, racedRegistration);
        if (backfillData || !isConfirmed(raced.persistenceStatus)) {
          const backfilled = await tx.selfInspectionLotEntry.update({
            where: { id: raced.id },
            data: {
              ...(backfillData ?? {}),
              persistenceStatus: SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED
            },
            include: { values: true, instrumentUsages: true }
          });
          await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
          return serializeLotEntry(backfilled);
        }
        if (!isSelfInspectionLotEntryRegistrationCompleteForPolicy(raced, registrationPolicy)) {
          throw new ApiError(
            400,
            `${requiredRegistrationLabelForPolicy(registrationPolicy)}のNFCタグが必要です`
          );
        }
        await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
        return serializeLotEntry(raced);
      }
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    return result;
  }

  async updateEntry(
    sessionId: string,
    entryId: string,
    input: {
      ifUnmodifiedSince: string;
      values: SelfInspectionMeasurementPayloadValue[];
      employeeTagUid?: string | null;
      measuringInstrumentTagUid?: string | null;
    }
  ) {
    const result = await prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);
      const session = await loadSessionForMutation(tx, sessionId);
      assertSessionEntryCountWritable(session);
      await assertInspectorRemeasurementNotStarted(tx, sessionId);
      const registrationPolicy = await getSelfInspectionRegistrationPolicy(tx);
      const existingEntry = await tx.selfInspectionLotEntry.findFirst({
        where: { id: entryId, sessionId },
        include: { values: true, instrumentUsages: true }
      });
      if (!existingEntry) {
        throw new ApiError(404, '自主検査入力が見つかりません');
      }
      assertEntryUnmodifiedSince(input.ifUnmodifiedSince, existingEntry.updatedAt);
      const registrationPatch = await resolveRegistrationPatchForUpdate(existingEntry, input, registrationPolicy);
      const values = validateMeasurementPayload(session.template, input.values, existingEntry.values);
      const locked = await tx.selfInspectionLotEntry.updateMany({
        where: { id: entryId, sessionId, updatedAt: existingEntry.updatedAt },
        data: {
          updatedAt: new Date(),
          persistenceStatus: SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED,
          ...registrationPatch
        }
      });
      if (locked.count === 0) {
        throw new ApiError(409, '他端末で更新されています。再読み込みしてください。');
      }
      await tx.selfInspectionMeasurementValue.deleteMany({ where: { entryId } });
      if (values.length > 0) {
        await tx.selfInspectionMeasurementValue.createMany({
          data: values.map((value) => ({
            entryId,
            templateItemId: value.templateItemId,
            value: value.value,
            reviewStatus: value.reviewStatus,
            outOfToleranceAcknowledgedAt: value.outOfToleranceAcknowledgedAt,
            approvedAt: value.approvedAt,
            approvedByUserId: value.approvedByUserId,
            approvedByUsername: value.approvedByUsername,
            approvalComment: value.approvalComment
          }))
        });
      }
      await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
      const updated = await tx.selfInspectionLotEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: { values: true, instrumentUsages: true }
      });
      return serializeLotEntry(updated);
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    return result;
  }

  async upsertDraftEntry(
    sessionId: string,
    input: {
      entryIndex: number;
      values?: SelfInspectionMeasurementPayloadValue[];
      employeeTagUid?: string | null;
      measuringInstrumentTagUid?: string | null;
      ifUnmodifiedSince?: string | null;
    }
  ) {
    const entryIndex = Math.floor(input.entryIndex);
    const result = await prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);
      const session = await loadSessionForMutation(tx, sessionId);
      assertSessionEntryCountWritable(session);
      await assertInspectorRemeasurementNotStarted(tx, sessionId);
      const templateConfig = templateConfigFromTemplate(session.template);
      assertEntryIndexAllowed(templateConfig, session.plannedQuantity, entryIndex);
      const slotKind = inferEntrySlotKindForIndex(
        templateConfig,
        session.plannedQuantity,
        entryIndex
      );
      const values = validateDraftMeasurementPayload(session.template, input.values ?? []);

      const existingEntry = await tx.selfInspectionLotEntry.findUnique({
        where: {
          sessionId_entryIndex: {
            sessionId,
            entryIndex
          }
        },
        include: { values: true, instrumentUsages: true }
      });

      await assertSelfInspectionEntryRegistrationTagUids({
        employeeTagUid: (input.employeeTagUid ?? '').trim() || null,
        measuringInstrumentTagUid: (input.measuringInstrumentTagUid ?? '').trim() || null
      });

      let createdByEmployeeId = existingEntry?.createdByEmployeeId ?? null;
      let createdByEmployeeNameSnapshot = existingEntry?.createdByEmployeeNameSnapshot ?? null;
      let measuringInstrumentId = existingEntry?.measuringInstrumentId ?? null;
      let measuringInstrumentManagementNumberSnapshot =
        existingEntry?.measuringInstrumentManagementNumberSnapshot ?? null;
      let measuringInstrumentNameSnapshot = existingEntry?.measuringInstrumentNameSnapshot ?? null;
      let measuringInstrumentTagUidSnapshot =
        existingEntry?.measuringInstrumentTagUidSnapshot ?? null;

      if (!createdByEmployeeId && (input.employeeTagUid ?? '').trim()) {
        const actor = await resolveEntryActor(input.employeeTagUid);
        createdByEmployeeId = actor.createdByEmployeeId;
        createdByEmployeeNameSnapshot = actor.createdByEmployeeNameSnapshot;
      }
      if (!measuringInstrumentId && (input.measuringInstrumentTagUid ?? '').trim()) {
        const instrument = await resolveMeasuringInstrumentByTag(input.measuringInstrumentTagUid);
        measuringInstrumentId = instrument.measuringInstrumentId;
        measuringInstrumentManagementNumberSnapshot =
          instrument.measuringInstrumentManagementNumberSnapshot;
        measuringInstrumentNameSnapshot = instrument.measuringInstrumentNameSnapshot;
        measuringInstrumentTagUidSnapshot = instrument.measuringInstrumentTagUidSnapshot;
      }

      if (!existingEntry) {
        const entry = await tx.selfInspectionLotEntry.create({
          data: {
            sessionId,
            entryIndex,
            entrySlotKind: slotKind,
            persistenceStatus: SELF_INSPECTION_ENTRY_PERSISTENCE_DRAFT,
            createdByEmployeeId,
            createdByEmployeeNameSnapshot,
            measuringInstrumentId,
            measuringInstrumentManagementNumberSnapshot,
            measuringInstrumentNameSnapshot,
            measuringInstrumentTagUidSnapshot,
            values: {
              create: values
            }
          },
          include: {
            values: true,
            instrumentUsages: true
          }
        });
        return serializeLotEntry(entry);
      }

      if (resolveDraftUpsertExistingDecision(existingEntry.persistenceStatus) === 'noop_keep_confirmed') {
        return serializeLotEntry(existingEntry);
      }

      if (input.ifUnmodifiedSince) {
        assertEntryUnmodifiedSince(input.ifUnmodifiedSince, existingEntry.updatedAt);
      }

      const locked = await tx.selfInspectionLotEntry.updateMany({
        where: {
          id: existingEntry.id,
          sessionId,
          ...(input.ifUnmodifiedSince ? { updatedAt: existingEntry.updatedAt } : {})
        },
        data: {
          updatedAt: new Date(),
          persistenceStatus: SELF_INSPECTION_ENTRY_PERSISTENCE_DRAFT,
          createdByEmployeeId,
          createdByEmployeeNameSnapshot,
          measuringInstrumentId,
          measuringInstrumentManagementNumberSnapshot,
          measuringInstrumentNameSnapshot,
          measuringInstrumentTagUidSnapshot
        }
      });
      if (locked.count === 0) {
        throw new ApiError(409, '他端末で更新されています。再読み込みしてください。');
      }

      await tx.selfInspectionMeasurementValue.deleteMany({ where: { entryId: existingEntry.id } });
      if (values.length > 0) {
        await tx.selfInspectionMeasurementValue.createMany({
          data: values.map((value) => ({
            entryId: existingEntry.id,
            templateItemId: value.templateItemId,
            value: value.value,
            reviewStatus: value.reviewStatus,
            outOfToleranceAcknowledgedAt: value.outOfToleranceAcknowledgedAt,
            approvedAt: value.approvedAt,
            approvedByUserId: value.approvedByUserId,
            approvedByUsername: value.approvedByUsername,
            approvalComment: value.approvalComment
          }))
        });
      }

      const updated = await tx.selfInspectionLotEntry.findUniqueOrThrow({
        where: { id: existingEntry.id },
        include: { values: true, instrumentUsages: true }
      });
      return serializeLotEntry(updated);
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    return result;
  }

  async completeSession(sessionId: string) {
    const sessionInclude = {
      template: { include: partMeasurementTemplateFullInclude },
      entries: { where: confirmedWhere, select: { entryIndex: true } },
      inspectorEntries: {
        select: {
          entryIndex: true,
          values: {
            select: {
              templateItemId: true,
              inspectorValue: true
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
      if (!existing) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
      if (existing.completedAt) {
        return existing;
      }
      const isInspectorFinalization =
        existing.decisionWorkflow === 'INSPECTOR_FINAL_JUDGEMENT';
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
          inspectorEntries: existing.inspectorEntries
        });
        if (inspectorCompletion.state !== 'complete') {
          throw new ApiError(409, '検査員の再測定が未完了のため完了できません');
        }
        await assertAllInspectorEntriesHaveRegistration(
          tx,
          sessionId,
          registrationPolicy
        );
        const unjudgedCount = await tx.selfInspectionMeasurementValue.count({
          where: {
            reviewStatus: 'PENDING',
            finalReviewStatus: null,
            entry: { sessionId, ...confirmedWhere },
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
        if (current?.completedAt) {
          return current;
        }
        throw new ApiError(409, '自主検査セッションを完了できません');
      }
      const completed = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: sessionInclude
      });
      if (!completed) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
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

  async listPendingOutOfToleranceReviews() {
    const rows = await prisma.selfInspectionMeasurementValue.findMany({
      where: {
        reviewStatus: 'PENDING',
        entry: {
          ...confirmedWhere,
          session: {
            recordApprovalWorkflowStartedAt: null
          }
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
                entries: {
                  where: confirmedWhere,
                  select: { entryIndex: true }
                },
                _count: {
                  select: confirmedEntriesCountSelect
                }
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
      const group = sessions.get(sessionId) ?? {
        session: row.entry.session,
        values: []
      };
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

  async approveOutOfToleranceReview(sessionId: string, input: {
    comment?: string | null;
    actorUserId: string;
    actorUsername: string;
  }) {
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
              inspectorValue: true
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
      if (!existing) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
      if (existing.recordApprovalWorkflowStartedAt) {
        throw new ApiError(409, 'この自主検査はキオスクの検査記録承認で承認してください');
      }
      const pendingCount = await tx.selfInspectionMeasurementValue.count({
        where: {
          reviewStatus: 'PENDING',
          entry: { sessionId, ...confirmedWhere }
        }
      });
      if (pendingCount === 0) {
        throw new ApiError(409, '承認待ちの公差外測定値がありません');
      }
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
        where: {
          reviewStatus: 'PENDING',
          entry: { sessionId }
        },
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
        if (finalized.count === 0) {
          throw new ApiError(409, '自主検査セッションを完了できません');
        }
      }
      const updated = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId },
        include: sessionInclude
      });
      if (!updated) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }
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

  async resetSession(
    sessionId: string,
    input: {
      confirmDestructiveReset: boolean;
      confirmCompletedSessionReset: boolean;
      requestId: string;
      reason?: string | null;
      clientDeviceId?: string | null;
      actorUserId?: string | null;
      actorUsername?: string | null;
      authMode: 'bearer' | 'client_key';
    }
  ) {
    const requestId = input.requestId.trim();
    if (!requestId) {
      throw new ApiError(400, 'requestId が必要です');
    }

    const session = await prisma.selfInspectionSession.findUnique({
      where: { id: sessionId }
    });
    if (!session) {
      throw new ApiError(404, '自主検査セッションが見つかりません');
    }

    let clientDeviceName: string | null = null;
    if (input.clientDeviceId) {
      const device = await prisma.clientDevice.findUnique({
        where: { id: input.clientDeviceId },
        select: { name: true }
      });
      clientDeviceName = device?.name ?? null;
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);
      const lockedSession = await tx.selfInspectionSession.findUnique({
        where: { id: sessionId }
      });
      if (!lockedSession) {
        throw new ApiError(404, '自主検査セッションが見つかりません');
      }

      assertSelfInspectionResetConfirmation({
        confirmDestructiveReset: input.confirmDestructiveReset,
        confirmCompletedSessionReset: input.confirmCompletedSessionReset,
        completedAt: lockedSession.completedAt
      });

      const scheduleRowId = normalizeText(lockedSession.scheduleRowId);
      if (!scheduleRowId) {
        throw new ApiError(400, '日程行IDがないためリセットできません');
      }

      await verifyProductionScheduleRowOrThrow(scheduleRowId, {
        productNo: lockedSession.productNo,
        fseiban: normalizeText(lockedSession.fseiban) || undefined,
        fhincd: lockedSession.fhincd,
        resourceCd: lockedSession.resourceCd
      });

      const supplement = await tx.productionScheduleOrderSupplement.findFirst({
        where: {
          csvDashboardRowId: scheduleRowId,
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
        },
        select: { plannedQuantity: true }
      });
      const plannedQuantity = resolveProductionSchedulePlannedQuantity(supplement?.plannedQuantity ?? null);
      if (plannedQuantity == null) {
        throw new ApiError(400, '指示数が補助データにないためリセットできません');
      }

      const activeTemplate = await tx.partMeasurementTemplate.findFirst({
        where: {
          fhincd: lockedSession.fhincd.trim(),
          processGroup: lockedSession.processGroup,
          resourceCd: lockedSession.resourceCd,
          isActive: true,
          templateScope: 'THREE_KEY'
        },
        orderBy: { version: 'desc' },
        include: partMeasurementTemplateFullInclude
      });
      if (!activeTemplate || !hasInspectionDrawingTemplateForReset(activeTemplate)) {
        throw new ApiError(400, '有効な自主検査図面テンプレートがないためリセットできません');
      }

      const templateConfig = templateConfigFromTemplateForReset(activeTemplate);
      const expectedEntryCount = resolveExpectedEntryCountForReset(templateConfig, plannedQuantity);

      const restartPayload = buildRestartPayloadFromSessionSnapshot({
        session: lockedSession,
        activeTemplateId: activeTemplate.id,
        plannedQuantity,
        expectedEntryCount
      });
      const sessionSnapshot = buildSessionResetSnapshot(lockedSession);
      const completedAtWasSet = lockedSession.completedAt != null;

      const entryCount = await tx.selfInspectionLotEntry.count({ where: { sessionId } });
      const valueCount = await tx.selfInspectionMeasurementValue.count({
        where: { entry: { sessionId } }
      });

      await tx.selfInspectionSession.delete({ where: { id: sessionId } });

      const sessionBusinessKey = buildSessionBusinessKey({
        productNo: restartPayload.productNo,
        processGroup: restartPayload.processGroup,
        resourceCd: restartPayload.resourceCd,
        scheduleRowId: restartPayload.scheduleRowId
      });

      const newSession = await tx.selfInspectionSession.create({
        data: {
          sessionBusinessKey,
          templateId: restartPayload.templateId,
          productNo: restartPayload.productNo,
          processGroup: restartPayload.processGroup,
          resourceCd: restartPayload.resourceCd,
          scheduleRowId: restartPayload.scheduleRowId,
          fseiban: restartPayload.fseiban,
          fhincd: restartPayload.fhincd,
          fhinmei: restartPayload.fhinmei,
          machineName: restartPayload.machineName,
          plannedQuantity: restartPayload.plannedQuantity,
          expectedEntryCount: restartPayload.expectedEntryCount,
          clientDeviceId: input.clientDeviceId ?? null,
          startedAt: new Date(),
          decisionWorkflow: 'INSPECTOR_FINAL_JUDGEMENT',
          recordApprovalWorkflowStartedAt: new Date()
        }
      });

      await tx.selfInspectionSessionResetAuditLog.create({
        data: {
          actionType: SELF_INSPECTION_RESET_ACTION_TYPE,
          sessionId,
          scheduleRowId: restartPayload.scheduleRowId,
          productNo: restartPayload.productNo,
          resourceCd: restartPayload.resourceCd,
          fhincd: restartPayload.fhincd,
          templateId: lockedSession.templateId,
          nextTemplateId: restartPayload.templateId,
          actorUserId: input.actorUserId ?? null,
          actorUsername: input.actorUsername ?? null,
          authMode: input.authMode,
          clientDeviceId: input.clientDeviceId ?? null,
          clientDeviceName,
          requestId,
          reason: input.reason?.trim() || null,
          completedAtWasSet,
          entryCount,
          valueCount,
          sessionSnapshot
        }
      });

      const auditPayload = {
        actionType: SELF_INSPECTION_RESET_ACTION_TYPE,
        sessionId,
        scheduleRowId: restartPayload.scheduleRowId,
        productNo: restartPayload.productNo,
        resourceCd: restartPayload.resourceCd,
        fhincd: restartPayload.fhincd,
        templateId: lockedSession.templateId,
        nextTemplateId: restartPayload.templateId,
        actorUserId: input.actorUserId ?? null,
        actorUsername: input.actorUsername ?? null,
        authMode: input.authMode,
        clientDeviceId: input.clientDeviceId ?? null,
        clientDeviceName,
        requestId,
        reason: input.reason?.trim() || null,
        completedAtWasSet,
        entryCount,
        valueCount,
        deletedSessionId: sessionId,
        newSessionId: newSession.id
      };
      logger.info(auditPayload, 'self_inspection_session_reset');

      return {
        deletedSessionId: sessionId,
        deletedEntryCount: entryCount,
        deletedValueCount: valueCount,
        newSession: serializeResetNewSession(newSession)
      };
    });
    resetSelfInspectionMachineBoardScheduleRowCaches();
    return result;
  }

  async buildLeaderboardDecorations(
    rows: Array<{
      id: string;
      rowData: Prisma.JsonValue;
      plannedQuantity?: number | null;
    }>,
    scope?: { siteKey?: string },
    cache?: SelfInspectionDecorationCache
  ) {
    return buildLeaderboardDecorationsOp(rows, scope, cache);
  }
}
