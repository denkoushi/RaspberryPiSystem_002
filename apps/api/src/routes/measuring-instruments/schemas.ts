import { z } from 'zod';
import pkg from '@prisma/client';

const { MeasuringInstrumentStatus, InspectionResult } = pkg;

export const instrumentBaseSchema = z.object({
  name: z.string().min(1, '名称は必須です'),
  managementNumber: z.string().min(1, '管理番号は必須です'),
  storageLocation: z.string().optional().nullable(),
  measurementRange: z.string().optional().nullable(),
  calibrationExpiryDate: z.coerce.date().optional().nullable(),
  status: z.nativeEnum(MeasuringInstrumentStatus).optional()
});

export const instrumentCreateSchema = instrumentBaseSchema;
export const instrumentUpdateSchema = instrumentBaseSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: '更新項目がありません'
});

export const instrumentQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(MeasuringInstrumentStatus).optional()
});

export const instrumentParamsSchema = z.object({
  id: z.string().uuid()
});

export const inspectionItemCreateSchema = z.object({
  measuringInstrumentId: z.string().uuid(),
  name: z.string().min(1),
  content: z.string().min(1),
  criteria: z.string().min(1),
  method: z.string().min(1),
  order: z.number().int().nonnegative()
});

export const inspectionItemUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  criteria: z.string().min(1).optional(),
  method: z.string().min(1).optional(),
  order: z.number().int().nonnegative().optional()
}).refine((data) => Object.keys(data).length > 0, { message: '更新項目がありません' });

export const inspectionItemParamsSchema = z.object({
  itemId: z.string().uuid()
});

export const tagCreateSchema = z.object({
  rfidTagUid: z.string().min(1)
});

export const tagParamsSchema = z.object({
  tagId: z.string().uuid()
});

export const inspectionRecordCreateSchema = z.object({
  measuringInstrumentId: z.string().uuid(),
  loanId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid(),
  inspectionItemId: z.string().uuid(),
  result: z.nativeEnum(InspectionResult),
  inspectedAt: z.coerce.date()
});

export const inspectionRecordQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  employeeId: z.string().uuid().optional(),
  result: z.nativeEnum(InspectionResult).optional()
});
