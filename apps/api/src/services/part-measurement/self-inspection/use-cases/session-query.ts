import type { PartMeasurementProcessGroup } from '@prisma/client';

import { ApiError } from '../../../../lib/errors.js';
import { prisma } from '../../../../lib/prisma.js';
import {
  collectParticipantEmployeeNames,
  collectParticipantEmployees
} from '../../self-inspection-participant-names.js';
import { loadParticipantSummariesBySessionIds } from '../../self-inspection-participant-names.query.js';
import { partMeasurementTemplateFullInclude } from '../../part-measurement-template-include.js';
import {
  confirmedEntriesCountSelect,
  isConfirmed
} from '../entry-persistence-status.js';
import {
  buildInspectorMeasurementCompletion,
  enrichSessionEntryCountFields,
  normalizeText,
  resolveStatus,
  serializeProcessGroup,
  sessionForEntryCountPolicy,
  templateConfigFromTemplate,
  type SelfInspectionStatusDto
} from '../shared.js';
import {
  listSessionsSummaryInclude,
  loadPendingReviewCountsBySessionIds,
  serializeDecisionWorkflow,
  serializeInspectorEntry,
  serializeInspectorEntryMeta,
  serializeLotEntry,
  serializeLotEntryMeta,
  serializeRecordApproval,
  serializeSessionSummary
} from '../serialization.js';
import {
  resolveTemplateFixedCount,
  serializeSelfInspectionMode
} from '../../self-inspection-config.js';
import { assertSelfInspectionSessionActive } from '../../self-inspection-invalidation-errors.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../../../production-schedule/seiban-machine-display-names.service.js';
import { isMissingSeibanMachineName } from '../../../production-schedule/seiban-machine-name-state.js';
import { LIST_SESSIONS_MAX } from './constants.js';

export async function listSelfInspectionSessions(query: {
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
      invalidatedAt: null,
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
  const missingMachineNameFseibans = boundedRows
    .filter((row) => isMissingSeibanMachineName(row.machineName))
    .map((row) => normalizeText(row.fseiban))
    .filter((fseiban) => fseiban.length > 0);
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched(missingMachineNameFseibans);
  const summaries = boundedRows.map((row) => {
    const participantSummary = participantSummariesBySessionId.get(row.id);
    const fseiban = normalizeText(row.fseiban);
    const machineName = !isMissingSeibanMachineName(row.machineName)
      ? row.machineName
      : fseiban.length > 0
        ? machineNames[fseiban] ?? null
        : null;
    return serializeSessionSummary(
      { ...row, machineName },
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

export async function getSelfInspectionSessionDetail(
  sessionId: string,
  options?: { entryIndex?: number }
) {
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
              inspectorValue: true,
              inspectorJudgementResult: true
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
  assertSelfInspectionSessionActive(session);

  const focusedEntryRow =
    entryIndex != null
      ? await prisma.selfInspectionLotEntry.findUnique({
          where: { sessionId_entryIndex: { sessionId, entryIndex } },
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
            values: { orderBy: { createdAt: 'asc' } }
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
    template: { ...templateConfig, itemIds: session.template.items.map((item) => item.id) },
    plannedQuantity: session.plannedQuantity,
    operatorEntries: session.entries,
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

export async function getInspectorMeasurementSessionDetail(
  sessionId: string,
  options?: { entryIndex?: number }
) {
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
          instrumentUsages: { orderBy: { preUseInspectedAt: 'asc' } },
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
  assertSelfInspectionSessionActive(session);

  const focusedEntryRow =
    entryIndex != null
      ? await prisma.selfInspectionInspectorEntry.findUnique({
          where: { sessionId_entryIndex: { sessionId, entryIndex } },
          include: {
            instrumentUsages: { orderBy: { preUseInspectedAt: 'asc' } },
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
    template: { ...templateConfig, itemIds: session.template.items.map((item) => item.id) },
    plannedQuantity: session.plannedQuantity,
    operatorEntries: session.entries,
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
    inspectorSlotStates: inspectorMeasurement.slotStates,
    recordApproval: serializeRecordApproval(session.recordApproval),
    updatedAt: session.updatedAt.toISOString(),
    template: session.template,
    entries: session.inspectorEntries.map((entry) => serializeInspectorEntryMeta(entry)),
    operatorEntries: session.entries.map((entry) => serializeLotEntryMeta(entry)),
    focusedEntry: focusedEntryRow ? serializeInspectorEntry(focusedEntryRow) : null
  };
}
