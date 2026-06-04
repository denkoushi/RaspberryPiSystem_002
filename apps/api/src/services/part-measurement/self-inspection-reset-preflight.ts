import type { PartMeasurementProcessGroup, SelfInspectionMode } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

import {
  tryResolveExpectedEntryCount,
  type SelfInspectionTemplateConfig
} from './self-inspection-config.js';

export const SELF_INSPECTION_RESET_ACTION_TYPE = 'RESET_SESSION';

export type SelfInspectionResetRestartPayload = {
  templateId: string;
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  scheduleRowId: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  machineName: string | null;
  plannedQuantity: number;
  expectedEntryCount: number;
};

export type SelfInspectionSessionResetSnapshot = {
  id: string;
  sessionBusinessKey: string;
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
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type InspectionDrawingTemplateLike = {
  isActive: boolean;
  visualTemplate?: { drawingImageRelativePath?: string | null } | null;
  items: Array<{
    markerXRatio: unknown;
    markerYRatio: unknown;
    lowerLimit: unknown;
    upperLimit: unknown;
  }>;
};

export function hasInspectionDrawingTemplateForReset(template: InspectionDrawingTemplateLike): boolean {
  if (!template.isActive || !template.visualTemplate?.drawingImageRelativePath?.trim()) return false;
  return (
    template.items.length > 0 &&
    template.items.every(
      (item) =>
        item.markerXRatio != null &&
        item.markerYRatio != null &&
        item.lowerLimit != null &&
        item.upperLimit != null
    )
  );
}

export function assertSelfInspectionResetConfirmation(input: {
  confirmDestructiveReset: boolean;
  confirmCompletedSessionReset: boolean;
  completedAt: Date | null;
}): void {
  if (!input.confirmDestructiveReset) {
    throw new ApiError(400, '破壊的リセットの確認が必要です');
  }
  if (input.completedAt && !input.confirmCompletedSessionReset) {
    throw new ApiError(400, '完了済みセッションのリセットには最終確認が必要です');
  }
}

export function resolveExpectedEntryCountForReset(
  template: SelfInspectionTemplateConfig,
  plannedQuantity: number
): number {
  const count = tryResolveExpectedEntryCount(template, plannedQuantity);
  if (count == null) {
    throw new ApiError(400, '自主検査の必要件数を決定できません');
  }
  return count;
}

export function buildRestartPayloadFromSessionSnapshot(input: {
  session: {
    productNo: string;
    processGroup: PartMeasurementProcessGroup;
    resourceCd: string;
    scheduleRowId: string | null;
    fseiban: string | null;
    fhincd: string;
    fhinmei: string;
    machineName: string | null;
  };
  activeTemplateId: string;
  plannedQuantity: number;
  expectedEntryCount: number;
}): SelfInspectionResetRestartPayload {
  const scheduleRowId = (input.session.scheduleRowId ?? '').trim();
  if (!scheduleRowId) {
    throw new ApiError(400, '日程行IDがないためリセットできません');
  }
  const fseiban = (input.session.fseiban ?? '').trim();
  if (!fseiban) {
    throw new ApiError(400, '製番がないためリセットできません');
  }
  const productNo = input.session.productNo.trim();
  const resourceCd = input.session.resourceCd.trim();
  const fhincd = input.session.fhincd.trim();
  const fhinmei = input.session.fhinmei.trim();
  if (!productNo || !resourceCd || !fhincd || !fhinmei) {
    throw new ApiError(400, '再開に必要なセッション情報が不足しています');
  }
  return {
    templateId: input.activeTemplateId,
    productNo,
    processGroup: input.session.processGroup,
    resourceCd,
    scheduleRowId,
    fseiban,
    fhincd,
    fhinmei,
    machineName: input.session.machineName?.trim() || null,
    plannedQuantity: input.plannedQuantity,
    expectedEntryCount: input.expectedEntryCount
  };
}

export function buildSessionResetSnapshot(session: {
  id: string;
  sessionBusinessKey: string;
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
  completedAt: Date | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SelfInspectionSessionResetSnapshot {
  return {
    id: session.id,
    sessionBusinessKey: session.sessionBusinessKey,
    templateId: session.templateId,
    productNo: session.productNo,
    processGroup: session.processGroup,
    resourceCd: session.resourceCd,
    scheduleRowId: session.scheduleRowId,
    fseiban: session.fseiban,
    fhincd: session.fhincd,
    fhinmei: session.fhinmei,
    machineName: session.machineName,
    plannedQuantity: session.plannedQuantity,
    expectedEntryCount: session.expectedEntryCount,
    completedAt: session.completedAt?.toISOString() ?? null,
    startedAt: session.startedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString()
  };
}

export function templateConfigFromTemplateForReset(template: {
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount?: number | null;
  selfInspectionSampleSize?: number | null;
}): SelfInspectionTemplateConfig {
  return {
    selfInspectionMode: template.selfInspectionMode,
    selfInspectionFixedCount: template.selfInspectionFixedCount ?? null,
    selfInspectionSampleSize: template.selfInspectionSampleSize ?? null
  };
}
