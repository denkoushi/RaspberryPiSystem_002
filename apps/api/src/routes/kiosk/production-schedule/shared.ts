import { z } from 'zod';

export const ORDER_NUMBER_MIN = 1;
export const ORDER_NUMBER_MAX = 10;
export const PROCESSING_TYPES = ['塗装', 'カニゼン', 'LSLH', 'その他01', 'その他02'] as const;

export const productionScheduleQuerySchema = z.object({
  productNo: z.string().min(1).max(100).optional(),
  q: z.string().min(1).max(200).optional(),
  resourceCds: z.string().min(1).max(400).optional(),
  resourceAssignedOnlyCds: z.string().min(1).max(400).optional(),
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

type ClientDeviceForLocation = { location?: string | null; name: string };

export type KioskRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: ClientDeviceForLocation;
  }>;
  resolveLocationKey: (clientDevice: ClientDeviceForLocation) => string;
};
