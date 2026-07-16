import { Prisma } from '@prisma/client';
import type { PartMeasurementProcessGroup, SelfInspectionMeasurementReviewStatus } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  collectParticipantEmployeeNames,
  collectParticipantEmployees,
  type SelfInspectionParticipantEmployee
} from '../self-inspection-participant-names.js';
import { loadParticipantSummariesBySessionIds } from '../self-inspection-participant-names.query.js';
import {
  isSelfInspectionLotEntryRegistrationCompleteForPolicy,
  type SelfInspectionRegistrationRequirementPolicy
} from '../self-inspection-registration-policy.service.js';
import { partMeasurementTemplateFullInclude } from '../part-measurement-template-include.js';
import {
  entrySlotLabelFromKind,
  listRequiredEntrySlots,
  resolveTemplateFixedCount,
  serializeEntrySlotKind,
  serializeSelfInspectionMode
} from '../self-inspection-config.js';
import {
  confirmedEntriesCountSelect,
  confirmedWhere,
  isConfirmed,
  SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED,
  serializePersistenceStatus
} from './entry-persistence-status.js';
import {
  buildInspectorMeasurementCompletion,
  enrichSessionEntryCountFields,
  isValueWithinTolerance,
  resolveStatus,
  serializeProcessGroup,
  sessionForEntryCountPolicy,
  templateConfigFromTemplate
} from './shared.js';


export const listSessionsSummaryInclude = {
  template: {
    select: {
      name: true,
      selfInspectionMode: true,
      selfInspectionFixedCount: true,
      selfInspectionSampleSize: true,
      items: {
        select: { id: true }
      }
    }
  },
  entries: {
    select: {
      entryIndex: true,
      persistenceStatus: true
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
  _count: { select: confirmedEntriesCountSelect }
} as const;

export const recordApprovalSessionInclude = {
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
      updatedAt: true,
      values: {
        select: {
          id: true,
          templateItemId: true,
          value: true,
          reviewStatus: true,
          outOfToleranceAcknowledgedAt: true,
          approvedAt: true,
          updatedAt: true
        }
      }
    }
  },
  inspectorEntries: {
    orderBy: { entryIndex: 'asc' },
    select: {
      id: true,
      entryIndex: true,
      entrySlotKind: true,
      inspectorEmployeeId: true,
      inspectorEmployeeCodeSnapshot: true,
      inspectorEmployeeNameSnapshot: true,
      inspectorEmployeeNfcTagUidSnapshot: true,
      measuringInstrumentId: true,
      measuringInstrumentManagementNumberSnapshot: true,
      measuringInstrumentNameSnapshot: true,
      measuringInstrumentTagUidSnapshot: true,
      clientDeviceId: true,
      clientDeviceNameSnapshot: true,
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
      updatedAt: true,
      values: {
        select: {
          id: true,
          templateItemId: true,
          operatorMeasurementValueId: true,
          operatorValueSnapshot: true,
          inspectorValue: true,
          differenceValue: true,
          judgementStatus: true,
          judgedAt: true,
          judgementComment: true,
          updatedAt: true
        }
      }
    }
  },
  recordApproval: true,
  _count: { select: confirmedEntriesCountSelect }
} as const;

export type SessionSummarySource = Prisma.SelfInspectionSessionGetPayload<{
  include: typeof listSessionsSummaryInclude;
}>;

export type RecordApprovalSessionSource = Prisma.SelfInspectionSessionGetPayload<{
  include: typeof recordApprovalSessionInclude;
}>;

type SessionWithCounts = Prisma.SelfInspectionSessionGetPayload<{
  include: {
    template: {
      include: typeof partMeasurementTemplateFullInclude;
    };
    entries: {
      where: typeof confirmedWhere;
      select: {
        entryIndex: true;
      };
    };
    inspectorEntries: {
      select: {
        entryIndex: true;
        values: {
          select: {
            templateItemId: true;
            inspectorValue: true;
          };
        };
      };
    };
    _count: {
      select: typeof confirmedEntriesCountSelect;
    };
  };
}>;

export async function loadPendingReviewCountsBySessionIds(
  db: Prisma.TransactionClient | typeof prisma,
  sessionIds: string[]
): Promise<Map<string, number>> {
  const uniqueSessionIds = [...new Set(sessionIds.filter((id) => id.trim().length > 0))];
  if (uniqueSessionIds.length === 0) {
    return new Map();
  }
  const rows = await db.selfInspectionMeasurementValue.findMany({
    where: {
      reviewStatus: 'PENDING',
      entry: {
        sessionId: { in: uniqueSessionIds },
        ...confirmedWhere
      }
    },
    select: {
      entry: {
        select: {
          sessionId: true
        }
      }
    }
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const sessionId = row.entry.sessionId;
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  }
  return counts;
}

export function serializeResetNewSession(session: {
  id: string;
  templateId: string;
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  scheduleRowId: string | null;
  fseiban: string | null;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  plannedQuantity: number;
  expectedEntryCount: number;
  recordApprovalRequiredAt: Date | null;
  recordApprovalWorkflowStartedAt: Date | null;
  decisionWorkflow: 'LEGACY_RECORD_APPROVAL' | 'INSPECTOR_FINAL_JUDGEMENT';
}) {
  return {
    id: session.id,
    templateId: session.templateId,
    productNo: session.productNo,
    processGroup: serializeProcessGroup(session.processGroup),
    resourceCd: session.resourceCd,
    scheduleRowId: session.scheduleRowId,
    fseiban: session.fseiban,
    fhincd: session.fhincd,
    fhinmei: session.fhinmei,
    machineName: session.machineName,
    plannedQuantity: session.plannedQuantity,
    expectedEntryCount: session.expectedEntryCount,
    participantEmployeeNames: [],
    participantEmployees: [],
    recordApprovalRequiredAt: session.recordApprovalRequiredAt?.toISOString() ?? null,
    recordApprovalWorkflowStartedAt: session.recordApprovalWorkflowStartedAt?.toISOString() ?? null,
    decisionWorkflow: session.decisionWorkflow
  };
}

export function serializeSessionSummary(
  session: SessionSummarySource | SessionWithCounts,
  participantEmployeeNames: string[] = [],
  pendingReviewCount = 0,
  participantEmployees: SelfInspectionParticipantEmployee[] = []
) {
  const policy = sessionForEntryCountPolicy(session);
  const completedEntryCount = session._count.entries;
  const lotEntries = 'entries' in session ? session.entries : [];
  const hasAnyLotEntry = lotEntries.length > 0 || completedEntryCount > 0;
  const confirmedEntryIndices = lotEntries
    .filter((entry) =>
      'persistenceStatus' in entry
        ? isConfirmed(
            (entry as { persistenceStatus?: string | null }).persistenceStatus ??
              SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED
          )
        : true
    )
    .map((entry) => entry.entryIndex);
  const status = resolveStatus({
    completedEntryCount,
    hasAnyLotEntry,
    completedAt: session.completedAt,
    pendingReviewCount,
    entryIndices: confirmedEntryIndices,
    completionPolicy: policy
  });
  const templateConfig = templateConfigFromTemplate(session.template);
  const inspectorMeasurement = buildInspectorMeasurementCompletion({
    inspectorRemeasurementRequiredAt: session.inspectorRemeasurementRequiredAt,
    recordApproval: 'recordApproval' in session ? session.recordApproval : null,
    completedAt: session.completedAt,
    template: {
      ...templateConfig,
      itemIds: session.template.items.map((item) => item.id)
    },
    plannedQuantity: session.plannedQuantity,
    inspectorEntries: 'inspectorEntries' in session ? session.inspectorEntries : []
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
    participantEmployeeNames,
    participantEmployees,
    selfInspectionMode: serializeSelfInspectionMode(session.template.selfInspectionMode),
    selfInspectionFixedCount: resolveTemplateFixedCount(templateConfig),
    selfInspectionSampleSize: resolveTemplateFixedCount(templateConfig),
    status,
    startedAt: session.startedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
    recordApprovalRequiredAt: session.recordApprovalRequiredAt?.toISOString() ?? null,
    recordApprovalWorkflowStartedAt: session.recordApprovalWorkflowStartedAt?.toISOString() ?? null,
    decisionWorkflow: session.decisionWorkflow,
    inspectorRemeasurementRequiredAt: session.inspectorRemeasurementRequiredAt?.toISOString() ?? null,
    inspectorMeasurementState: inspectorMeasurement.state,
    inspectorRequiredEntryCount: inspectorMeasurement.requiredEntryCount,
    inspectorCompletedRequiredEntryCount: inspectorMeasurement.completedRequiredEntryCount,
    inspectorMissingRequiredEntryCount: inspectorMeasurement.missingRequiredEntryCount,
    inspectorIncompleteValueEntryCount: inspectorMeasurement.incompleteValueEntryCount,
    updatedAt: session.updatedAt.toISOString()
  };
}

export async function serializeSessionSummaryWithAggregatedParticipantNames(
  session: SessionSummarySource | SessionWithCounts
) {
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

export type SelfInspectionRecordApprovalState =
  | 'input_incomplete'
  | 'inspector_measurement_pending'
  | 'registration_incomplete'
  | 'approvable'
  | 'approved';

export type SelfInspectionApproverResolveResult =
  | {
      kind: 'employee';
      employee: {
        id: string;
        employeeCode: string;
        displayName: string;
        nfcTagUid: string;
      };
    }
  | { kind: 'unknown' }
  | { kind: 'inactive'; status: string }
  | { kind: 'instrument' }
  | { kind: 'duplicate' };

export function serializeRecordApproval(approval: RecordApprovalSessionSource['recordApproval']) {
  if (!approval) return null;
  return {
    id: approval.id,
    approvedAt: approval.approvedAt.toISOString(),
    approverEmployeeId: approval.approverEmployeeId,
    approverEmployeeCodeSnapshot: approval.approverEmployeeCodeSnapshot,
    approverEmployeeNameSnapshot: approval.approverEmployeeNameSnapshot,
    approverEmployeeNfcTagUidSnapshot: approval.approverEmployeeNfcTagUidSnapshot,
    comment: approval.comment,
    clientDeviceId: approval.clientDeviceId,
    clientDeviceNameSnapshot: approval.clientDeviceNameSnapshot
  };
}

export function requiredRegistrationLabelForPolicy(
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
): string {
  return registrationPolicy.requireMeasuringInstrumentTag ? '測定者または計測機器の使用前点検' : '測定者';
}

function pendingReviewCountFromRecordApprovalSession(session: RecordApprovalSessionSource): number {
  let count = 0;
  for (const entry of session.entries) {
    count += entry.values.filter((value) => value.reviewStatus === 'PENDING').length;
  }
  return count;
}

export function serializeInstrumentUsage(usage: {
  id: string;
  measuringInstrumentId: string | null;
  loanId: string | null;
  measuringInstrumentManagementNumberSnapshot: string;
  measuringInstrumentNameSnapshot: string;
  measuringInstrumentTagUidSnapshot: string | null;
  preUseInspectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: usage.id,
    measuringInstrumentId: usage.measuringInstrumentId,
    loanId: usage.loanId,
    measuringInstrumentManagementNumberSnapshot: usage.measuringInstrumentManagementNumberSnapshot,
    measuringInstrumentNameSnapshot: usage.measuringInstrumentNameSnapshot,
    measuringInstrumentTagUidSnapshot: usage.measuringInstrumentTagUidSnapshot,
    preUseInspectedAt: usage.preUseInspectedAt.toISOString(),
    createdAt: usage.createdAt.toISOString(),
    updatedAt: usage.updatedAt.toISOString()
  };
}

function isSelfInspectionInspectorEntryRegistrationCompleteForPolicy(
  entry: {
    inspectorEmployeeId: string | null;
    measuringInstrumentId: string | null;
    instrumentUsages: unknown[];
  },
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
): boolean {
  return isSelfInspectionLotEntryRegistrationCompleteForPolicy(
    {
      createdByEmployeeId: entry.inspectorEmployeeId,
      measuringInstrumentId: entry.measuringInstrumentId,
      measuringInstrumentUsageCount: entry.instrumentUsages.length
    },
    registrationPolicy
  );
}

export function buildRecordApprovalReadiness(
  session: RecordApprovalSessionSource,
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
): {
  state: SelfInspectionRecordApprovalState;
  requiredEntryCount: number;
  completedRequiredEntryCount: number;
  missingRequiredEntryCount: number;
  incompleteValueEntryCount: number;
  incompleteRegistrationEntryCount: number;
  inspectorCompletedRequiredEntryCount: number;
  inspectorMissingRequiredEntryCount: number;
  inspectorIncompleteValueEntryCount: number;
  inspectorIncompleteRegistrationEntryCount: number;
  pendingReviewCount: number;
} {
  const requiredSlots = listRequiredEntrySlots(
    templateConfigFromTemplate(session.template),
    session.plannedQuantity
  );
  const entriesByIndex = new Map(session.entries.map((entry) => [entry.entryIndex, entry]));
  let completedRequiredEntryCount = 0;
  let missingRequiredEntryCount = 0;
  let incompleteValueEntryCount = 0;
  let incompleteRegistrationEntryCount = 0;
  let inspectorCompletedRequiredEntryCount = 0;
  let inspectorMissingRequiredEntryCount = 0;
  let inspectorIncompleteValueEntryCount = 0;
  let inspectorIncompleteRegistrationEntryCount = 0;

  for (const slot of requiredSlots) {
    const entry = entriesByIndex.get(slot.entryIndex);
    if (!entry || !isConfirmed(entry.persistenceStatus)) {
      missingRequiredEntryCount += 1;
      continue;
    }
    completedRequiredEntryCount += 1;
    const valuesByItemId = new Map(entry.values.map((value) => [value.templateItemId, value]));
    const hasMissingValue = session.template.items.some((item) => {
      const stored = valuesByItemId.get(item.id);
      return stored?.value == null;
    });
    if (hasMissingValue) {
      incompleteValueEntryCount += 1;
    }
    if (
      !isSelfInspectionLotEntryRegistrationCompleteForPolicy(
        { ...entry, measuringInstrumentUsageCount: entry.instrumentUsages.length },
        registrationPolicy
      )
    ) {
      incompleteRegistrationEntryCount += 1;
    }
  }

  if (session.inspectorRemeasurementRequiredAt && !session.recordApproval) {
    const inspectorEntriesByIndex = new Map(
      session.inspectorEntries.map((entry) => [entry.entryIndex, entry])
    );
    for (const slot of requiredSlots) {
      const inspectorEntry = inspectorEntriesByIndex.get(slot.entryIndex);
      if (!inspectorEntry) {
        inspectorMissingRequiredEntryCount += 1;
        continue;
      }
      inspectorCompletedRequiredEntryCount += 1;
      const valuesByItemId = new Map(
        inspectorEntry.values.map((value) => [value.templateItemId, value])
      );
      const hasMissingValue = session.template.items.some((item) => {
        const stored = valuesByItemId.get(item.id);
        return stored?.inspectorValue == null;
      });
      if (hasMissingValue) {
        inspectorIncompleteValueEntryCount += 1;
      }
      if (
        !isSelfInspectionInspectorEntryRegistrationCompleteForPolicy(
          inspectorEntry,
          registrationPolicy
        )
      ) {
        inspectorIncompleteRegistrationEntryCount += 1;
      }
    }
  }

  const pendingReviewCount = pendingReviewCountFromRecordApprovalSession(session);
  const state: SelfInspectionRecordApprovalState = session.recordApproval
    ? 'approved'
    : missingRequiredEntryCount > 0 || incompleteValueEntryCount > 0 || requiredSlots.length === 0
      ? 'input_incomplete'
      : incompleteRegistrationEntryCount > 0
        ? 'registration_incomplete'
      : inspectorMissingRequiredEntryCount > 0 || inspectorIncompleteValueEntryCount > 0
        ? 'inspector_measurement_pending'
      : inspectorIncompleteRegistrationEntryCount > 0
        ? 'registration_incomplete'
        : 'approvable';

  return {
    state,
    requiredEntryCount: requiredSlots.length,
    completedRequiredEntryCount,
    missingRequiredEntryCount,
    incompleteValueEntryCount,
    incompleteRegistrationEntryCount,
    inspectorCompletedRequiredEntryCount,
    inspectorMissingRequiredEntryCount,
    inspectorIncompleteValueEntryCount,
    inspectorIncompleteRegistrationEntryCount,
    pendingReviewCount
  };
}

export function serializeRecordApprovalSessionListItem(
  session: RecordApprovalSessionSource,
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
) {
  const readiness = buildRecordApprovalReadiness(session, registrationPolicy);
  const summary = serializeSessionSummary(
    session,
    collectParticipantEmployeeNames(session.entries),
    readiness.pendingReviewCount,
    collectParticipantEmployees(session.entries)
  );
  return {
    ...summary,
    recordApprovalRequiredAt: session.recordApprovalRequiredAt?.toISOString() ?? null,
    recordApprovalState: readiness.state,
    recordApproval: serializeRecordApproval(session.recordApproval),
    requiredEntryCount: readiness.requiredEntryCount,
    completedRequiredEntryCount: readiness.completedRequiredEntryCount,
    missingRequiredEntryCount: readiness.missingRequiredEntryCount,
    incompleteValueEntryCount: readiness.incompleteValueEntryCount,
    incompleteRegistrationEntryCount: readiness.incompleteRegistrationEntryCount,
    inspectorCompletedRequiredEntryCount: readiness.inspectorCompletedRequiredEntryCount,
    inspectorMissingRequiredEntryCount: readiness.inspectorMissingRequiredEntryCount,
    inspectorIncompleteValueEntryCount: readiness.inspectorIncompleteValueEntryCount,
    inspectorIncompleteRegistrationEntryCount: readiness.inspectorIncompleteRegistrationEntryCount
  };
}

export function serializeRecordApprovalEntryDetail(
  session: RecordApprovalSessionSource,
  slot: ReturnType<typeof listRequiredEntrySlots>[number],
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
) {
  const entry = session.entries.find((row) => row.entryIndex === slot.entryIndex) ?? null;
  const inspectorEntry =
    session.inspectorEntries.find((row) => row.entryIndex === slot.entryIndex) ?? null;
  const valuesByItemId = new Map((entry?.values ?? []).map((value) => [value.templateItemId, value]));
  const inspectorValuesByItemId = new Map(
    (inspectorEntry?.values ?? []).map((value) => [value.templateItemId, value])
  );
  const values = session.template.items.map((item) => {
    const stored = valuesByItemId.get(item.id) ?? null;
    const inspectorStored = inspectorValuesByItemId.get(item.id) ?? null;
    const numericValue = stored?.value ?? null;
    return {
      id: stored?.id ?? null,
      templateItemId: item.id,
      displayMarker: item.displayMarker,
      datumSurface: item.datumSurface,
      measurementPoint: item.measurementPoint,
      measurementLabel: item.measurementLabel,
      unit: item.unit,
      value: numericValue != null ? String(numericValue) : null,
      lowerLimit: item.lowerLimit != null ? String(item.lowerLimit) : null,
      upperLimit: item.upperLimit != null ? String(item.upperLimit) : null,
      isWithinTolerance: numericValue != null ? isValueWithinTolerance(item, numericValue) : null,
      reviewStatus: stored?.reviewStatus ?? null,
      outOfToleranceAcknowledgedAt: stored?.outOfToleranceAcknowledgedAt?.toISOString() ?? null,
      approvedAt: stored?.approvedAt?.toISOString() ?? null,
      updatedAt: stored?.updatedAt.toISOString() ?? null,
      inspectorValueId: inspectorStored?.id ?? null,
      inspectorValue: inspectorStored?.inspectorValue != null ? String(inspectorStored.inspectorValue) : null,
      operatorValueSnapshot:
        inspectorStored?.operatorValueSnapshot != null ? String(inspectorStored.operatorValueSnapshot) : null,
      differenceValue:
        inspectorStored?.differenceValue != null ? String(inspectorStored.differenceValue) : null,
      inspectorJudgementStatus: inspectorStored?.judgementStatus ?? null,
      inspectorJudgedAt: inspectorStored?.judgedAt?.toISOString() ?? null,
      inspectorJudgementComment: inspectorStored?.judgementComment ?? null,
      inspectorUpdatedAt: inspectorStored?.updatedAt.toISOString() ?? null
    };
  });
  const hasMissingValue = values.some((value) => value.value == null);
  const registrationComplete = entry
    ? isSelfInspectionLotEntryRegistrationCompleteForPolicy(
        { ...entry, measuringInstrumentUsageCount: entry.instrumentUsages.length },
        registrationPolicy
      )
    : false;
  const state = !entry || hasMissingValue
    ? 'input_incomplete'
    : !registrationComplete
      ? 'registration_incomplete'
      : 'ready';
  return {
    entryIndex: slot.entryIndex,
    entrySlotKind: slot.entrySlotKind,
    entrySlotLabel: slot.entrySlotLabel,
    state,
    entry: entry
      ? {
          id: entry.id,
          createdByEmployeeId: entry.createdByEmployeeId,
          createdByEmployeeNameSnapshot: entry.createdByEmployeeNameSnapshot,
          measuringInstrumentId: entry.measuringInstrumentId,
          measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
          measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
          measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot,
          instrumentUsages: entry.instrumentUsages.map(serializeInstrumentUsage),
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString()
        }
      : null,
    inspectorEntry: inspectorEntry
      ? {
          id: inspectorEntry.id,
          inspectorEmployeeId: inspectorEntry.inspectorEmployeeId,
          inspectorEmployeeCodeSnapshot: inspectorEntry.inspectorEmployeeCodeSnapshot,
          inspectorEmployeeNameSnapshot: inspectorEntry.inspectorEmployeeNameSnapshot,
          inspectorEmployeeNfcTagUidSnapshot: inspectorEntry.inspectorEmployeeNfcTagUidSnapshot,
          measuringInstrumentId: inspectorEntry.measuringInstrumentId,
          measuringInstrumentManagementNumberSnapshot:
            inspectorEntry.measuringInstrumentManagementNumberSnapshot,
          measuringInstrumentNameSnapshot: inspectorEntry.measuringInstrumentNameSnapshot,
          measuringInstrumentTagUidSnapshot: inspectorEntry.measuringInstrumentTagUidSnapshot,
          clientDeviceId: inspectorEntry.clientDeviceId,
          clientDeviceNameSnapshot: inspectorEntry.clientDeviceNameSnapshot,
          instrumentUsages: inspectorEntry.instrumentUsages.map(serializeInstrumentUsage),
          createdAt: inspectorEntry.createdAt.toISOString(),
          updatedAt: inspectorEntry.updatedAt.toISOString()
        }
      : null,
    values
  };
}

export function serializeLotEntryMeta(entry: {
  id: string;
  entryIndex: number;
  entrySlotKind: import('@prisma/client').SelfInspectionEntrySlotKind;
  persistenceStatus?: import('@prisma/client').SelfInspectionEntryPersistenceStatus | null;
  createdByEmployeeId: string | null;
  createdByEmployeeNameSnapshot: string | null;
  measuringInstrumentId: string | null;
  measuringInstrumentManagementNumberSnapshot: string | null;
  measuringInstrumentNameSnapshot: string | null;
  measuringInstrumentTagUidSnapshot: string | null;
  instrumentUsages?: Array<Parameters<typeof serializeInstrumentUsage>[0]>;
  createdAt: Date;
  updatedAt: Date;
}) {
  const slotDto = serializeEntrySlotKind(entry.entrySlotKind);
  return {
    id: entry.id,
    entryIndex: entry.entryIndex,
    entrySlotKind: slotDto,
    entrySlotLabel: entrySlotLabelFromKind(slotDto, entry.entryIndex),
    persistenceStatus: serializePersistenceStatus(entry.persistenceStatus),
    createdByEmployeeId: entry.createdByEmployeeId,
    createdByEmployeeNameSnapshot: entry.createdByEmployeeNameSnapshot,
    measuringInstrumentId: entry.measuringInstrumentId,
    measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
    measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
    measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot,
    instrumentUsages: (entry.instrumentUsages ?? []).map(serializeInstrumentUsage),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    values: [] as Array<{
      id: string;
      templateItemId: string;
      value: string | null;
      reviewStatus: SelfInspectionMeasurementReviewStatus;
      outOfToleranceAcknowledgedAt: string | null;
      approvedAt: string | null;
      approvedByUserId: string | null;
      approvedByUsername: string | null;
      approvalComment: string | null;
    }>
  };
}

export function serializeLotEntry(
  entry: Prisma.SelfInspectionLotEntryGetPayload<{ include: { values: true } }> & {
    instrumentUsages: Array<Parameters<typeof serializeInstrumentUsage>[0]>;
  }
) {
  const slotDto = serializeEntrySlotKind(entry.entrySlotKind);
  return {
    id: entry.id,
    entryIndex: entry.entryIndex,
    entrySlotKind: slotDto,
    entrySlotLabel: entrySlotLabelFromKind(slotDto, entry.entryIndex),
    persistenceStatus: serializePersistenceStatus(entry.persistenceStatus),
    createdByEmployeeId: entry.createdByEmployeeId,
    createdByEmployeeNameSnapshot: entry.createdByEmployeeNameSnapshot,
    measuringInstrumentId: entry.measuringInstrumentId,
    measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
    measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
    measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot,
    instrumentUsages: entry.instrumentUsages.map(serializeInstrumentUsage),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    values: entry.values.map((value) => ({
      id: value.id,
      templateItemId: value.templateItemId,
      value: value.value != null ? String(value.value) : null,
      reviewStatus: value.reviewStatus,
      outOfToleranceAcknowledgedAt: value.outOfToleranceAcknowledgedAt?.toISOString() ?? null,
      approvedAt: value.approvedAt?.toISOString() ?? null,
      approvedByUserId: value.approvedByUserId,
      approvedByUsername: value.approvedByUsername,
      approvalComment: value.approvalComment
    }))
  };
}

export async function loadLotEntryForSerialization(
  db: Prisma.TransactionClient,
  entryId: string
): Promise<
  Prisma.SelfInspectionLotEntryGetPayload<{ include: { values: true } }> & {
    instrumentUsages: Array<Parameters<typeof serializeInstrumentUsage>[0]>;
  }
> {
  return db.selfInspectionLotEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: {
      instrumentUsages: {
        orderBy: { preUseInspectedAt: 'asc' }
      },
      values: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });
}

export function serializeInspectorEntryMeta(entry: {
  id: string;
  entryIndex: number;
  entrySlotKind: import('@prisma/client').SelfInspectionEntrySlotKind;
  inspectorEmployeeId: string | null;
  inspectorEmployeeCodeSnapshot: string | null;
  inspectorEmployeeNameSnapshot: string | null;
  inspectorEmployeeNfcTagUidSnapshot: string | null;
  measuringInstrumentId: string | null;
  measuringInstrumentManagementNumberSnapshot: string | null;
  measuringInstrumentNameSnapshot: string | null;
  measuringInstrumentTagUidSnapshot: string | null;
  clientDeviceId?: string | null;
  clientDeviceNameSnapshot?: string | null;
  instrumentUsages?: Array<Parameters<typeof serializeInstrumentUsage>[0]>;
  createdAt: Date;
  updatedAt: Date;
}) {
  const slotDto = serializeEntrySlotKind(entry.entrySlotKind);
  return {
    id: entry.id,
    entryIndex: entry.entryIndex,
    entrySlotKind: slotDto,
    entrySlotLabel: entrySlotLabelFromKind(slotDto, entry.entryIndex),
    createdByEmployeeId: entry.inspectorEmployeeId,
    createdByEmployeeNameSnapshot: entry.inspectorEmployeeNameSnapshot,
    inspectorEmployeeId: entry.inspectorEmployeeId,
    inspectorEmployeeCodeSnapshot: entry.inspectorEmployeeCodeSnapshot,
    inspectorEmployeeNameSnapshot: entry.inspectorEmployeeNameSnapshot,
    inspectorEmployeeNfcTagUidSnapshot: entry.inspectorEmployeeNfcTagUidSnapshot,
    measuringInstrumentId: entry.measuringInstrumentId,
    measuringInstrumentManagementNumberSnapshot: entry.measuringInstrumentManagementNumberSnapshot,
    measuringInstrumentNameSnapshot: entry.measuringInstrumentNameSnapshot,
    measuringInstrumentTagUidSnapshot: entry.measuringInstrumentTagUidSnapshot,
    clientDeviceId: entry.clientDeviceId ?? null,
    clientDeviceNameSnapshot: entry.clientDeviceNameSnapshot ?? null,
    instrumentUsages: (entry.instrumentUsages ?? []).map(serializeInstrumentUsage),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    values: [] as Array<{
      id: string;
      templateItemId: string;
      value: string | null;
      reviewStatus: SelfInspectionMeasurementReviewStatus;
      outOfToleranceAcknowledgedAt: string | null;
      approvedAt: string | null;
      approvedByUserId: string | null;
      approvedByUsername: string | null;
      approvalComment: string | null;
      operatorValueSnapshot?: string | null;
      differenceValue?: string | null;
      judgementStatus?: string;
    }>
  };
}

export function serializeInspectorEntry(
  entry: Prisma.SelfInspectionInspectorEntryGetPayload<{
    include: {
      values: {
        include: {
          operatorMeasurementValue: {
            select: { reviewStatus: true };
          };
        };
      };
    };
  }> & {
    instrumentUsages: Array<Parameters<typeof serializeInstrumentUsage>[0]>;
  }
) {
  const meta = serializeInspectorEntryMeta(entry);
  return {
    ...meta,
    values: entry.values.map((value) => ({
      id: value.id,
      templateItemId: value.templateItemId,
      value: value.inspectorValue != null ? String(value.inspectorValue) : null,
      reviewStatus: 'NOT_REQUIRED' as SelfInspectionMeasurementReviewStatus,
      outOfToleranceAcknowledgedAt: null,
      approvedAt: null,
      approvedByUserId: null,
      approvedByUsername: null,
      approvalComment: null,
      operatorMeasurementValueId: value.operatorMeasurementValueId,
      operatorValueSnapshot:
        value.operatorValueSnapshot != null ? String(value.operatorValueSnapshot) : null,
      differenceValue: value.differenceValue != null ? String(value.differenceValue) : null,
      judgementStatus: value.judgementStatus,
      operatorReviewStatus: value.operatorMeasurementValue?.reviewStatus ?? null,
      judgedAt: value.judgedAt?.toISOString() ?? null,
      judgementComment: value.judgementComment,
      updatedAt: value.updatedAt.toISOString()
    }))
  };
}

export async function loadInspectorEntryForSerialization(
  db: Prisma.TransactionClient,
  entryId: string
): Promise<
  Prisma.SelfInspectionInspectorEntryGetPayload<{
    include: {
      values: {
        include: {
          operatorMeasurementValue: {
            select: { reviewStatus: true };
          };
        };
      };
    };
  }> & {
    instrumentUsages: Array<Parameters<typeof serializeInstrumentUsage>[0]>;
  }
> {
  return db.selfInspectionInspectorEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: {
      instrumentUsages: {
        orderBy: { preUseInspectedAt: 'asc' }
      },
      values: {
        orderBy: { createdAt: 'asc' },
        include: {
          operatorMeasurementValue: {
            select: { reviewStatus: true }
          }
        }
      }
    }
  });
}
