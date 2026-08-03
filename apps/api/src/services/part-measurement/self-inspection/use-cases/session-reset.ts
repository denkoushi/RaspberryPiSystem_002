import { ApiError } from '../../../../lib/errors.js';
import { logger } from '../../../../lib/logger.js';
import { prisma } from '../../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../../production-schedule/constants.js';
import { resolveProductionSchedulePlannedQuantity } from '../../../production-schedule/self-inspection-schedule-eligibility.js';
import { verifyProductionScheduleRowOrThrow } from '../../../production-schedule/verify-production-schedule-row.js';
import { partMeasurementTemplateFullInclude } from '../../part-measurement-template-include.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../../self-inspection-machine-board-cache-invalidation.js';
import { assertSelfInspectionSessionActive } from '../../self-inspection-invalidation-errors.js';
import { lockSelfInspectionItemBusinessKey } from '../../self-inspection-item-lock.repository.js';
import {
  assertSelfInspectionResetConfirmation,
  buildRestartPayloadFromSessionSnapshot,
  buildSessionResetSnapshot,
  hasInspectionDrawingTemplateForReset,
  resolveExpectedEntryCountForReset,
  SELF_INSPECTION_RESET_ACTION_TYPE,
  templateConfigFromTemplateForReset
} from '../../self-inspection-reset-preflight.js';
import { lockSessionRow } from '../mutation-guards.js';
import { buildSessionBusinessKey, normalizeText } from '../shared.js';
import { serializeResetNewSession } from '../serialization.js';

export async function resetSelfInspectionSession(
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
  if (!requestId) throw new ApiError(400, 'requestId が必要です');

  const session = await prisma.selfInspectionSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new ApiError(404, '自主検査セッションが見つかりません');
  assertSelfInspectionSessionActive(session);

  let clientDeviceName: string | null = null;
  if (input.clientDeviceId) {
    const device = await prisma.clientDevice.findUnique({
      where: { id: input.clientDeviceId },
      select: { name: true }
    });
    clientDeviceName = device?.name ?? null;
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockSelfInspectionItemBusinessKey(tx, session.sessionBusinessKey);
    await lockSessionRow(tx, sessionId);
    const lockedSession = await tx.selfInspectionSession.findUnique({ where: { id: sessionId } });
    if (!lockedSession) throw new ApiError(404, '自主検査セッションが見つかりません');
    assertSelfInspectionSessionActive(lockedSession);

    assertSelfInspectionResetConfirmation({
      confirmDestructiveReset: input.confirmDestructiveReset,
      confirmCompletedSessionReset: input.confirmCompletedSessionReset,
      completedAt: lockedSession.completedAt
    });

    const scheduleRowId = normalizeText(lockedSession.scheduleRowId);
    if (!scheduleRowId) throw new ApiError(400, '日程行IDがないためリセットできません');
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
    const plannedQuantity = resolveProductionSchedulePlannedQuantity(
      supplement?.plannedQuantity ?? null
    );
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

    logger.info(
      {
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
      },
      'self_inspection_session_reset'
    );
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
