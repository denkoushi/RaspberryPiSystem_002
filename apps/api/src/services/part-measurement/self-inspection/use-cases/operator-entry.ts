import { Prisma } from '@prisma/client';

import { ApiError } from '../../../../lib/errors.js';
import { prisma } from '../../../../lib/prisma.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../../self-inspection-machine-board-cache-invalidation.js';
import { markSelfInspectionRecordApprovalRequiredAfterMeasurementSave } from '../../self-inspection-record-approval-saved-gate.js';
import {
  getSelfInspectionRegistrationPolicy,
  isSelfInspectionLotEntryRegistrationCompleteForPolicy
} from '../../self-inspection-registration-policy.service.js';
import {
  assertEntryIndexAllowed,
  inferEntrySlotKindForIndex
} from '../../self-inspection-config.js';
import { resolveDraftUpsertExistingDecision } from '../entry-draft-upsert-guard.js';
import { validateDraftMeasurementPayload } from '../entry-draft-validation.js';
import {
  SELF_INSPECTION_ENTRY_PERSISTENCE_CONFIRMED,
  SELF_INSPECTION_ENTRY_PERSISTENCE_DRAFT,
  isConfirmed
} from '../entry-persistence-status.js';
import {
  buildRegistrationBackfillData,
  entryRegistrationFromRow,
  resolveMeasuringInstrumentByTag,
  resolveRegistrationForCreateEntry,
  resolveRegistrationPatchForUpdate
} from '../entry-registration.js';
import {
  appendMeasurementOperation,
  requireMeasurementActorAuthentication
} from '../measurement-actor-authentication.js';
import {
  assertLotEntryValuesMatchPayload,
  assertSessionEntryCountWritable,
  loadSessionForMutation,
  lockSessionRow,
  validateMeasurementPayload
} from '../mutation-guards.js';
import { assertOperatorEntryNotLockedByInspector } from '../operator-entry-inspector-lock.js';
import { assertSelfInspectionEntryRegistrationTagUids } from '../../self-inspection-registration-tag-validation.js';
import {
  assertEntryUnmodifiedSince,
  templateConfigFromTemplate,
  type SelfInspectionMeasurementPayloadValue
} from '../shared.js';
import {
  requiredRegistrationLabelForPolicy,
  serializeLotEntry
} from '../serialization.js';

export async function createSelfInspectionEntry(
  sessionId: string,
  input: {
    entryIndex: number;
    values: SelfInspectionMeasurementPayloadValue[];
    measurementActorAuthenticationId: string;
    measuringInstrumentTagUid?: string | null;
    createdByEmployeeId?: string | null;
    createdByEmployeeNameSnapshot?: string | null;
    clientDeviceId?: string | null;
  }
) {
  const entryIndex = Math.floor(input.entryIndex);
  const result = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const session = await loadSessionForMutation(tx, sessionId);
    const actor = await requireMeasurementActorAuthentication(tx, {
      sessionId,
      authenticationId: input.measurementActorAuthenticationId,
      mode: 'OPERATOR',
      clientDeviceId: input.clientDeviceId
    });
    assertSessionEntryCountWritable(session);
    const registrationPolicy = await getSelfInspectionRegistrationPolicy(tx);
    input.createdByEmployeeId = actor.employeeId;
    input.createdByEmployeeNameSnapshot = actor.employeeNameSnapshot;
    const templateConfig = templateConfigFromTemplate(session.template);
    assertEntryIndexAllowed(templateConfig, session.plannedQuantity, entryIndex);
    await assertOperatorEntryNotLockedByInspector(tx, sessionId, entryIndex);
    const slotKind = inferEntrySlotKindForIndex(templateConfig, session.plannedQuantity, entryIndex);

    const existingAtIndex = await tx.selfInspectionLotEntry.findUnique({
      where: { sessionId_entryIndex: { sessionId, entryIndex } },
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
        await appendMeasurementOperation(tx, {
          sessionId,
          authenticationId: actor.id,
          mode: 'OPERATOR',
          entryIndex,
          operationKind: 'ENTRY_CONFIRMED'
        });
        return serializeLotEntry(backfilled);
      }
      if (!isSelfInspectionLotEntryRegistrationCompleteForPolicy(existingAtIndex, registrationPolicy)) {
        throw new ApiError(
          400,
          `${requiredRegistrationLabelForPolicy(registrationPolicy)}のNFCタグが必要です`
        );
      }
      await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
      await appendMeasurementOperation(tx, {
        sessionId,
        authenticationId: actor.id,
        mode: 'OPERATOR',
        entryIndex,
        operationKind: 'ENTRY_CONFIRMED'
      });
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
          values: { create: values }
        },
        include: { values: true, instrumentUsages: true }
      });
      await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
      await appendMeasurementOperation(tx, {
        sessionId,
        authenticationId: actor.id,
        mode: 'OPERATOR',
        entryIndex,
        operationKind: 'ENTRY_CONFIRMED'
      });
      return serializeLotEntry(entry);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const raced = await tx.selfInspectionLotEntry.findUnique({
        where: { sessionId_entryIndex: { sessionId, entryIndex } },
        include: { values: true, instrumentUsages: true }
      });
      if (!raced) throw error;
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
        await appendMeasurementOperation(tx, {
          sessionId,
          authenticationId: actor.id,
          mode: 'OPERATOR',
          entryIndex,
          operationKind: 'ENTRY_CONFIRMED'
        });
        return serializeLotEntry(backfilled);
      }
      if (!isSelfInspectionLotEntryRegistrationCompleteForPolicy(raced, registrationPolicy)) {
        throw new ApiError(
          400,
          `${requiredRegistrationLabelForPolicy(registrationPolicy)}のNFCタグが必要です`
        );
      }
      await markSelfInspectionRecordApprovalRequiredAfterMeasurementSave(tx, sessionId);
      await appendMeasurementOperation(tx, {
        sessionId,
        authenticationId: actor.id,
        mode: 'OPERATOR',
        entryIndex,
        operationKind: 'ENTRY_CONFIRMED'
      });
      return serializeLotEntry(raced);
    }
  });
  resetSelfInspectionMachineBoardScheduleRowCaches();
  return result;
}

export async function updateSelfInspectionEntry(
  sessionId: string,
  entryId: string,
  input: {
    ifUnmodifiedSince: string;
    values: SelfInspectionMeasurementPayloadValue[];
    measurementActorAuthenticationId: string;
    measuringInstrumentTagUid?: string | null;
    clientDeviceId?: string | null;
  }
) {
  const result = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const session = await loadSessionForMutation(tx, sessionId);
    const actor = await requireMeasurementActorAuthentication(tx, {
      sessionId,
      authenticationId: input.measurementActorAuthenticationId,
      mode: 'OPERATOR',
      clientDeviceId: input.clientDeviceId
    });
    assertSessionEntryCountWritable(session);
    const registrationPolicy = await getSelfInspectionRegistrationPolicy(tx);
    const existingEntry = await tx.selfInspectionLotEntry.findFirst({
      where: { id: entryId, sessionId },
      include: { values: true, instrumentUsages: true }
    });
    if (!existingEntry) throw new ApiError(404, '自主検査入力が見つかりません');
    await assertOperatorEntryNotLockedByInspector(tx, sessionId, existingEntry.entryIndex);
    assertEntryUnmodifiedSince(input.ifUnmodifiedSince, existingEntry.updatedAt);
    const registrationPatch = await resolveRegistrationPatchForUpdate(
      existingEntry,
      {
        ...input,
        createdByEmployeeId: actor.employeeId,
        createdByEmployeeNameSnapshot: actor.employeeNameSnapshot
      },
      registrationPolicy
    );
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
          judgementResult: value.judgementResult,
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
    await appendMeasurementOperation(tx, {
      sessionId,
      authenticationId: actor.id,
      mode: 'OPERATOR',
      entryIndex: existingEntry.entryIndex,
      operationKind: 'ENTRY_CONFIRMED'
    });
    const updated = await tx.selfInspectionLotEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { values: true, instrumentUsages: true }
    });
    return serializeLotEntry(updated);
  });
  resetSelfInspectionMachineBoardScheduleRowCaches();
  return result;
}

export async function upsertSelfInspectionDraftEntry(
  sessionId: string,
  input: {
    entryIndex: number;
    values?: SelfInspectionMeasurementPayloadValue[];
    measurementActorAuthenticationId: string;
    measuringInstrumentTagUid?: string | null;
    ifUnmodifiedSince?: string | null;
    clientDeviceId?: string | null;
  }
) {
  const entryIndex = Math.floor(input.entryIndex);
  const result = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const session = await loadSessionForMutation(tx, sessionId);
    const actor = await requireMeasurementActorAuthentication(tx, {
      sessionId,
      authenticationId: input.measurementActorAuthenticationId,
      mode: 'OPERATOR',
      clientDeviceId: input.clientDeviceId
    });
    assertSessionEntryCountWritable(session);
    const templateConfig = templateConfigFromTemplate(session.template);
    assertEntryIndexAllowed(templateConfig, session.plannedQuantity, entryIndex);
    await assertOperatorEntryNotLockedByInspector(tx, sessionId, entryIndex);
    const slotKind = inferEntrySlotKindForIndex(templateConfig, session.plannedQuantity, entryIndex);
    const values = validateDraftMeasurementPayload(session.template, input.values ?? []);
    const existingEntry = await tx.selfInspectionLotEntry.findUnique({
      where: { sessionId_entryIndex: { sessionId, entryIndex } },
      include: { values: true, instrumentUsages: true }
    });

    await assertSelfInspectionEntryRegistrationTagUids({
      employeeTagUid: null,
      measuringInstrumentTagUid: (input.measuringInstrumentTagUid ?? '').trim() || null
    });

    let createdByEmployeeId = existingEntry?.createdByEmployeeId ?? null;
    let createdByEmployeeNameSnapshot = existingEntry?.createdByEmployeeNameSnapshot ?? null;
    let measuringInstrumentId = existingEntry?.measuringInstrumentId ?? null;
    let measuringInstrumentManagementNumberSnapshot =
      existingEntry?.measuringInstrumentManagementNumberSnapshot ?? null;
    let measuringInstrumentNameSnapshot = existingEntry?.measuringInstrumentNameSnapshot ?? null;
    let measuringInstrumentTagUidSnapshot = existingEntry?.measuringInstrumentTagUidSnapshot ?? null;

    if (!createdByEmployeeId) {
      createdByEmployeeId = actor.employeeId;
      createdByEmployeeNameSnapshot = actor.employeeNameSnapshot;
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
          values: { create: values }
        },
        include: { values: true, instrumentUsages: true }
      });
      await appendMeasurementOperation(tx, {
        sessionId,
        authenticationId: actor.id,
        mode: 'OPERATOR',
        entryIndex,
        operationKind: 'DRAFT_AUTOSAVED'
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
          judgementResult: value.judgementResult,
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
    await appendMeasurementOperation(tx, {
      sessionId,
      authenticationId: actor.id,
      mode: 'OPERATOR',
      entryIndex,
      operationKind: 'DRAFT_AUTOSAVED'
    });
    return serializeLotEntry(updated);
  });
  resetSelfInspectionMachineBoardScheduleRowCaches();
  return result;
}
