import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { z } from 'zod';
import { DUE_MANAGEMENT_TUNING_REASON_CODES } from '../../../services/production-schedule/auto-tuning/tuning-reason-code.js';
import type { ClientDeviceForScopeResolution, LocationScopeContext } from '../shared.js';

export const ORDER_NUMBER_MIN = 1;
export const ORDER_NUMBER_MAX = 10;
export const PROCESSING_TYPES = ['塗装', 'カニゼン', 'LSLH', 'その他01', 'その他02'] as const;

export const productionScheduleQuerySchema = z.object({
  productNo: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(200).optional(),
  productNos: z.string().min(1).max(4000).optional(),
  resourceCds: z.string().min(1).max(400).optional(),
  resourceAssignedOnlyCds: z.string().min(1).max(400).optional(),
  resourceCategory: z.enum(['grinding', 'cutting']).optional(),
  machineName: z.string().min(1).max(200).optional(),
  hasNoteOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  hasDueDateOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(2000).optional(),
  allowResourceOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  /** v2: Mac の一覧/usage 取得時に必須（サーバ側で検証） */
  targetDeviceScopeKey: z.string().min(1).max(200).optional(),
  /**
   * `leaderboard`: キオスク順位ボード向けに actual-hours 解決を省略しレイテンシを抑える。
   * 機種名（`resolvedMachineName`）は full と同じバッチ解決を行い、順位ボードの表示欠落を防ぐ（既定は full）。
   */
  responseProfile: z.enum(['full', 'leaderboard']).optional()
});

export const productionScheduleOrderSearchQuerySchema = z.object({
  resourceCds: z.string().min(1).max(400),
  resourceCategory: z.enum(['grinding', 'cutting']).optional(),
  machineName: z.string().min(1).max(200).optional(),
  productNoPrefix: z.string().regex(/^\d{5,10}$/),
  partName: z.string().min(1).max(200).optional()
});

export const parseCsvList = (value: string | undefined): string[] => {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    )
  );
};

export type LegacyLocationKey = string;

// Bridge helper: legacy service contracts still consume `locationKey` string.
// Callers must pass `deviceScopeKey` explicitly at route boundaries.
export const toLegacyLocationKeyFromDeviceScope = (
  deviceScopeKey: LocationScopeContext['deviceScopeKey']
): LegacyLocationKey =>
  deviceScopeKey;

export const productionScheduleCompleteParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleOrderParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleOrderBodySchema = z.object({
  resourceCd: z.string().min(1).max(100),
  orderNumber: z.number().int().min(ORDER_NUMBER_MIN).max(ORDER_NUMBER_MAX).nullable(),
  targetLocation: z.string().min(1).max(100).optional(),
  /** v2: Mac 代理更新時に必須 */
  targetDeviceScopeKey: z.string().min(1).max(200).optional()
});

export const productionScheduleNoteParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleNoteBodySchema = z.object({
  note: z
    .string()
    .max(100)
    .transform((s) => s.replace(/\r?\n/g, '').trim())
});

export const productionScheduleDueDateParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleDueDateBodySchema = z.object({
  dueDate: z.string().max(20).transform((s) => s.trim())
});

export const productionScheduleProcessingParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleProcessingBodySchema = z.object({
  processingType: z
    .string()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() : ''))
});

export const productionScheduleSearchStateBodySchema = z.object({
  state: z.object({
    inputQuery: z.string().max(200).optional(),
    activeQueries: z.array(z.string().max(200)).max(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX).optional(),
    activeResourceCds: z.array(z.string().max(100)).max(100).optional(),
    activeResourceAssignedOnlyCds: z.array(z.string().max(100)).max(100).optional(),
    history: z.array(z.string().max(200)).max(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX).optional()
  })
});

export const productionScheduleSearchHistoryBodySchema = z.object({
  history: z.array(z.string().max(200)).max(KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX)
});

/** 素の入力を多めに受け、trim・重複除去後に 100 件まで保持する。 */
export const productionScheduleSeibanMachineNamesBodySchema = z
  .object({
    fseibans: z.array(z.string().max(200)).max(100)
  })
  .transform((body) => ({
    fseibans: Array.from(
      new Set(body.fseibans.map((value) => value.trim()).filter((value) => value.length > 0))
    ).slice(0, 100)
  }));

export const productionScheduleDueManagementSeibanParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim())
});

export const productionScheduleDueManagementFilterQuerySchema = z.object({
  resourceCd: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() : undefined)),
  resourceCategory: z.enum(['grinding', 'cutting']).optional()
});

export const productionScheduleDueManagementSeibanProcessingParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim()),
  processingType: z.string().min(1).max(20).transform((value) => value.trim())
});

export const productionScheduleDueManagementSeibanDueDateBodySchema = z.object({
  dueDate: z.string().max(20).transform((value) => value.trim())
});

export const productionScheduleDueManagementPartPrioritiesBodySchema = z.object({
  orderedFhincds: z.array(z.string().min(1).max(50)).max(2000)
});

export const productionScheduleDueManagementPartParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim()),
  fhincd: z.string().min(1).max(50).transform((value) => value.trim())
});

export const productionScheduleDueManagementTriageSelectionBodySchema = z.object({
  selectedFseibans: z.array(z.string().min(1).max(20).transform((value) => value.trim())).max(2000)
});

export const productionScheduleDueManagementDailyPlanBodySchema = z.object({
  orderedFseibans: z.array(z.string().min(1).max(20).transform((value) => value.trim())).max(2000)
});

export const productionScheduleDueManagementGlobalRankBodySchema = z.object({
  orderedFseibans: z.array(z.string().min(1).max(20).transform((value) => value.trim())).max(2000),
  reasonCode: z.enum(DUE_MANAGEMENT_TUNING_REASON_CODES).optional(),
  targetLocation: z.string().min(1).max(100).optional(),
  rankingScope: z.enum(['globalShared', 'locationScoped', 'localTemporary']).optional()
});

export const productionScheduleDueManagementGlobalRankAutoGenerateBodySchema = z
  .object({
    minCandidateCount: z.number().int().min(1).max(2000).optional(),
    maxReorderDeltaRatio: z.number().min(0).max(1).optional(),
    keepExistingTail: z.boolean().optional(),
    targetLocation: z.string().min(1).max(100).optional(),
    rankingScope: z.enum(['globalShared', 'locationScoped', 'localTemporary']).optional()
  })
  .optional();

export const productionScheduleDueManagementGlobalRankQuerySchema = productionScheduleDueManagementFilterQuerySchema.extend({
  targetLocation: z.string().min(1).max(100).optional(),
  rankingScope: z.enum(['globalShared', 'locationScoped', 'localTemporary']).optional()
});

export const productionScheduleDueManagementGlobalRankExplanationParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim())
});

export const productionScheduleDueManagementLearningReportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  targetLocation: z.string().min(1).max(100).optional(),
  rankingScope: z.enum(['globalShared', 'locationScoped', 'localTemporary']).optional()
});

export const productionScheduleDueManagementManualOrderOverviewQuerySchema = z.object({
  targetLocation: z.string().min(1).max(100).optional(),
  /** v2: 工場キー（必須・サーバ側で検証） */
  siteKey: z.string().min(1).max(100).optional(),
  /** v2: 端末で絞り込み。`__legacy_site__` で旧サイト単位行のみ */
  deviceScopeKey: z.string().min(1).max(200).optional(),
  resourceCd: z.string().max(100).optional()
});

export const productionScheduleDueManagementActualHoursImportBodySchema = z.object({
  csvContent: z.string().min(1),
});

export const productionScheduleDueManagementActualHoursStatsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type KioskRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: ClientDeviceForScopeResolution;
  }>;
  resolveLocationScopeContext: (clientDevice: ClientDeviceForScopeResolution) => LocationScopeContext;
  resolveTargetLocation: (params: { requestedTargetLocation?: string; actorLocation: string }) => string;
};
