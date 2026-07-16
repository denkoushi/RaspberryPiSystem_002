import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../self-inspection-machine-board-cache-invalidation.js';
import { getSelfInspectionRegistrationPolicy } from '../self-inspection-registration-policy.service.js';
import {
  assertEntryIndexAllowed,
  inferEntrySlotKindForIndex
} from '../self-inspection-config.js';
import {
  assertEntryUnmodifiedSince,
  templateConfigFromTemplate,
  type SelfInspectionMeasurementPayloadValue
} from './shared.js';
import {
  assertSessionEntryCountWritable,
  loadSessionForMutation,
  lockSessionRow,
  validateMeasurementPayload
} from './mutation-guards.js';
import { resolveInspectorRegistrationForSave } from './entry-registration.js';
import {
  loadInspectorEntryForSerialization,
  serializeInspectorEntry
} from './serialization.js';

export async function saveInspectorEntry(
  sessionId: string,
  input: {
    entryIndex: number;
    values: SelfInspectionMeasurementPayloadValue[];
    employeeTagUid?: string | null;
    measuringInstrumentTagUid?: string | null;
    clientDeviceId?: string | null;
  },
  options?: {
    entryId?: string;
    ifUnmodifiedSince?: string;
  }
) {
  const entryIndex = Math.floor(input.entryIndex);
  const result = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const session = await loadSessionForMutation(tx, sessionId);
    assertSessionEntryCountWritable(session);
    if (!session.recordApprovalRequiredAt || !session.inspectorRemeasurementRequiredAt) {
      throw new ApiError(409, 'オペレータの自主検査記録保存後に検査員再測定を開始してください');
    }
    const existingApproval = await tx.selfInspectionRecordApproval.findUnique({
      where: { sessionId },
      select: { id: true }
    });
    if (existingApproval) {
      throw new ApiError(409, '承認済みの検査記録は検査員再測定を変更できません');
    }

    const registrationPolicy = await getSelfInspectionRegistrationPolicy(tx);
    const templateConfig = templateConfigFromTemplate(session.template);
    assertEntryIndexAllowed(templateConfig, session.plannedQuantity, entryIndex);
    const slotKind = inferEntrySlotKindForIndex(
      templateConfig,
      session.plannedQuantity,
      entryIndex
    );

    const operatorEntry = await tx.selfInspectionLotEntry.findUnique({
      where: {
        sessionId_entryIndex: {
          sessionId,
          entryIndex
        }
      },
      include: {
        values: true
      }
    });
    if (!operatorEntry) {
      throw new ApiError(409, 'オペレータの測定値が未登録のため検査員再測定できません');
    }
    if (!operatorEntry.createdByEmployeeId) {
      throw new ApiError(409, 'オペレータの測定者が未登録のため検査員再測定できません');
    }
    const operatorValuesByItemId = new Map(
      operatorEntry.values.map((value) => [value.templateItemId, value])
    );
    for (const item of session.template.items) {
      const operatorValue = operatorValuesByItemId.get(item.id);
      if (operatorValue?.value == null) {
        throw new ApiError(409, 'オペレータの測定値が未登録のため検査員再測定できません');
      }
    }

    const existingEntry = options?.entryId
      ? await tx.selfInspectionInspectorEntry.findFirst({
          where: { id: options.entryId, sessionId },
          include: { values: true, instrumentUsages: true }
        })
      : await tx.selfInspectionInspectorEntry.findUnique({
          where: {
            sessionId_entryIndex: {
              sessionId,
              entryIndex
            }
          },
          include: { values: true, instrumentUsages: true }
        });
    if (options?.entryId && !existingEntry) {
      throw new ApiError(404, '検査員再測定入力が見つかりません');
    }
    if (existingEntry && existingEntry.entryIndex !== entryIndex) {
      throw new ApiError(400, '入力件番号が検査員再測定入力と一致しません');
    }
    if (existingEntry && options?.ifUnmodifiedSince) {
      assertEntryUnmodifiedSince(options.ifUnmodifiedSince, existingEntry.updatedAt);
    }
    if (
      existingEntry?.values.some((value) => value.judgementStatus !== 'NOT_EVALUATED')
    ) {
      throw new ApiError(409, '最終判定済みの検査員再測定は変更できません');
    }

    const values = validateMeasurementPayload(
      session.template,
      input.values,
      []
    );
    const registration = await resolveInspectorRegistrationForSave(
      tx,
      existingEntry,
      operatorEntry,
      input,
      registrationPolicy
    );
    const clientDevice = input.clientDeviceId
      ? await tx.clientDevice.findUnique({
          where: { id: input.clientDeviceId },
          select: { id: true, name: true }
        })
      : null;

    const entryData = {
      entryIndex,
      entrySlotKind: slotKind,
      inspectorEmployeeId: registration.inspectorEmployeeId,
      inspectorEmployeeCodeSnapshot: registration.inspectorEmployeeCodeSnapshot,
      inspectorEmployeeNameSnapshot: registration.inspectorEmployeeNameSnapshot,
      inspectorEmployeeNfcTagUidSnapshot: registration.inspectorEmployeeNfcTagUidSnapshot,
      measuringInstrumentId: registration.measuringInstrumentId,
      measuringInstrumentManagementNumberSnapshot:
        registration.measuringInstrumentManagementNumberSnapshot,
      measuringInstrumentNameSnapshot: registration.measuringInstrumentNameSnapshot,
      measuringInstrumentTagUidSnapshot: registration.measuringInstrumentTagUidSnapshot,
      clientDeviceId: clientDevice?.id ?? null,
      clientDeviceNameSnapshot: clientDevice?.name ?? null
    };

    const savedEntry = existingEntry
      ? await tx.selfInspectionInspectorEntry.update({
          where: { id: existingEntry.id },
          data: entryData
        })
      : await tx.selfInspectionInspectorEntry.create({
          data: {
            sessionId,
            ...entryData
          }
        });

    await tx.selfInspectionInspectorMeasurementValue.deleteMany({
      where: { inspectorEntryId: savedEntry.id }
    });
    await tx.selfInspectionInspectorMeasurementValue.createMany({
      data: values.map((value) => {
        const operatorValue = operatorValuesByItemId.get(value.templateItemId);
        const operatorValueSnapshot = operatorValue?.value ?? null;
        return {
          inspectorEntryId: savedEntry.id,
          templateItemId: value.templateItemId,
          operatorMeasurementValueId: operatorValue?.id ?? null,
          operatorValueSnapshot,
          inspectorValue: value.value,
          differenceValue:
            operatorValueSnapshot != null ? value.value.minus(operatorValueSnapshot) : null,
          judgementStatus: 'NOT_EVALUATED' as const
        };
      })
    });
    await tx.selfInspectionSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() }
    });

    const serializedEntry = await loadInspectorEntryForSerialization(tx, savedEntry.id);
    return serializeInspectorEntry(serializedEntry);
  });
  resetSelfInspectionMachineBoardScheduleRowCaches();
  return result;
}

export async function saveInspectorJudgements(
  sessionId: string,
  entryId: string,
  input: {
    judgements: Array<{
      templateItemId: string;
      judgementStatus: 'FINAL_OK' | 'FINAL_NG';
    }>;
  }
) {
  const result = await prisma.$transaction(async (tx) => {
    await lockSessionRow(tx, sessionId);
    const session = await loadSessionForMutation(tx, sessionId);
    assertSessionEntryCountWritable(session);
    if (session.decisionWorkflow !== 'INSPECTOR_FINAL_JUDGEMENT') {
      throw new ApiError(409, 'この自主検査は従来の記録承認フローです');
    }
    const entry = await tx.selfInspectionInspectorEntry.findFirst({
      where: { id: entryId, sessionId },
      include: {
        values: {
          include: {
            operatorMeasurementValue: { select: { reviewStatus: true } }
          }
        }
      }
    });
    if (!entry) throw new ApiError(404, '検査員再測定入力が見つかりません');

    const pendingValues = entry.values.filter(
      (value) => value.operatorMeasurementValue?.reviewStatus === 'PENDING'
    );
    if (pendingValues.length === 0) {
      throw new ApiError(409, 'この入力に最終判定が必要な公差外測定値はありません');
    }
    const judgementByItemId = new Map(input.judgements.map((value) => [value.templateItemId, value]));
    if (judgementByItemId.size !== input.judgements.length) {
      throw new ApiError(400, '最終判定の測定点が重複しています');
    }
    if (
      judgementByItemId.size !== pendingValues.length ||
      pendingValues.some((value) => !judgementByItemId.has(value.templateItemId))
    ) {
      throw new ApiError(400, '測定者側で公差外となった全測定点を判定してください');
    }
    if (pendingValues.some((value) => value.inspectorValue == null)) {
      throw new ApiError(409, '検査員の再測定値を保存してから最終判定してください');
    }

    const judgedAt = new Date();
    await Promise.all(
      pendingValues.map(async (value) => {
        const judgement = judgementByItemId.get(value.templateItemId)!;
        await tx.selfInspectionInspectorMeasurementValue.update({
          where: { id: value.id },
          data: {
            judgementStatus: judgement.judgementStatus,
            judgedAt,
            judgementComment: null
          }
        });
        if (value.operatorMeasurementValueId) {
          await tx.selfInspectionMeasurementValue.update({
            where: { id: value.operatorMeasurementValueId },
            data: {
              reviewStatus:
                judgement.judgementStatus === 'FINAL_OK' ? 'APPROVED' : 'REJECTED',
              approvedAt:
                judgement.judgementStatus === 'FINAL_OK' ? judgedAt : null,
              approvedByUserId:
                judgement.judgementStatus === 'FINAL_OK' ? entry.inspectorEmployeeId : null,
              approvedByUsername:
                judgement.judgementStatus === 'FINAL_OK'
                  ? entry.inspectorEmployeeNameSnapshot
                  : null,
              approvalComment: null
            }
          });
        }
      })
    );
    await tx.selfInspectionSession.update({ where: { id: sessionId }, data: { updatedAt: judgedAt } });
    return loadInspectorEntryForSerialization(tx, entry.id);
  });
  resetSelfInspectionMachineBoardScheduleRowCaches();
  return serializeInspectorEntry(result);
}
