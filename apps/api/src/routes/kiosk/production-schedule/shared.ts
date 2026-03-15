import { z } from 'zod';
import { DUE_MANAGEMENT_TUNING_REASON_CODES } from '../../../services/production-schedule/auto-tuning/tuning-reason-code.js';

export const ORDER_NUMBER_MIN = 1;
export const ORDER_NUMBER_MAX = 10;
export const PROCESSING_TYPES = ['塗装', 'カニゼン', 'LSLH', 'その他01', 'その他02'] as const;

export const productionScheduleQuerySchema = z.object({
  productNo: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(200).optional(),
  resourceCds: z.string().min(1).max(400).optional(),
  resourceAssignedOnlyCds: z.string().min(1).max(400).optional(),
  resourceCategory: z.enum(['grinding', 'cutting']).optional(),
  hasNoteOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  hasDueDateOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(2000).optional()
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

export const productionScheduleCompleteParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleOrderParamsSchema = z.object({
  rowId: z.string().uuid()
});

export const productionScheduleOrderBodySchema = z.object({
  resourceCd: z.string().min(1).max(100),
  orderNumber: z.number().int().min(ORDER_NUMBER_MIN).max(ORDER_NUMBER_MAX).nullable()
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
    activeQueries: z.array(z.string().max(200)).max(20).optional(),
    activeResourceCds: z.array(z.string().max(100)).max(100).optional(),
    activeResourceAssignedOnlyCds: z.array(z.string().max(100)).max(100).optional(),
    history: z.array(z.string().max(200)).max(20).optional()
  })
});

export const productionScheduleSearchHistoryBodySchema = z.object({
  history: z.array(z.string().max(200)).max(20)
});

export const productionScheduleDueManagementSeibanParamsSchema = z.object({
  fseiban: z.string().min(1).max(20).transform((value) => value.trim())
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

export const productionScheduleDueManagementGlobalRankQuerySchema = z.object({
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

export const productionScheduleDueManagementActualHoursImportBodySchema = z.object({
  csvContent: z.string().min(1),
});

export const productionScheduleDueManagementActualHoursStatsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

type ClientDeviceForScopeResolution = {
  id?: string;
  apiKey?: string;
  statusClientId?: string | null;
  location?: string | null;
  name: string;
};
type LocationScopeContext = {
  deviceScopeKey: string;
  siteKey: string;
  deviceName: string;
  infraHost: string;
  credentialIdentity: {
    clientDeviceId: string;
    apiKey: string;
    statusClientId: string | null;
  };
};

export type KioskRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: ClientDeviceForScopeResolution;
  }>;
  resolveLocationScopeContext: (clientDevice: ClientDeviceForScopeResolution) => LocationScopeContext;
  resolveTargetLocation: (params: { requestedTargetLocation?: string; actorLocation: string }) => string;
};
