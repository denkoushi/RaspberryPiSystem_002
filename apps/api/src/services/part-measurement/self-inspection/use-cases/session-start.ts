import type { PartMeasurementProcessGroup } from '@prisma/client';

import { ApiError } from '../../../../lib/errors.js';
import { prisma } from '../../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../../production-schedule/constants.js';
import { resolveProductionSchedulePlannedQuantity } from '../../../production-schedule/self-inspection-schedule-eligibility.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../../../production-schedule/seiban-machine-display-names.service.js';
import { normalizeSeibanMachineNameForPersistence } from '../../../production-schedule/seiban-machine-name-state.js';
import { verifyProductionScheduleRowOrThrow } from '../../../production-schedule/verify-production-schedule-row.js';
import { partMeasurementTemplateFullInclude } from '../../part-measurement-template-include.js';
import {
  confirmedEntriesCountSelect,
  confirmedWhere
} from '../../self-inspection/entry-persistence-status.js';
import { lockSelfInspectionItemBusinessKey } from '../../self-inspection-item-lock.repository.js';
import { selfInspectionInvalidationConflict } from '../../self-inspection-invalidation-errors.js';
import {
  buildSessionBusinessKey,
  hasInspectionDrawingTemplate,
  normalizeText,
  resolveExpectedEntryCount,
  templateConfigFromTemplate
} from '../shared.js';
import { serializeSessionSummaryWithAggregatedParticipantNames } from '../serialization.js';

export type ResolveOrCreateSelfInspectionSessionInput = {
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
};

export async function resolveOrCreateSelfInspectionSession(
  input: ResolveOrCreateSelfInspectionSessionInput
) {
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
  const { machineNames } = await resolveSeibanMachineDisplayNamesBatched([fseiban]);
  const canonicalMachineName = normalizeSeibanMachineNameForPersistence(machineNames[fseiban]);
  const supplement = await prisma.productionScheduleOrderSupplement.findFirst({
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
    await lockSelfInspectionItemBusinessKey(tx, sessionBusinessKey);
    const invalidation = await tx.selfInspectionItemInvalidation.findUnique({
      where: { itemBusinessKey: sessionBusinessKey },
      select: { id: true }
    });
    if (invalidation) {
      throw selfInspectionInvalidationConflict('削除済みの自主検査アイテムは再開始できません');
    }
    return tx.selfInspectionSession.upsert({
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
        machineName: canonicalMachineName,
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
  });

  return serializeSessionSummaryWithAggregatedParticipantNames(session);
}
