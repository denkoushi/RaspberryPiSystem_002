import { z } from 'zod';
import pkg from '@prisma/client';

const { RiggingStatus, InspectionResult } = pkg;

export const riggingGearBaseSchema = z.object({
  name: z.string().min(1, '名称は必須です'),
  managementNumber: z.string().min(1, '管理番号は必須です'),
  storageLocation: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  maxLoadTon: z.coerce.number().optional().nullable(),
  lengthMm: z.coerce.number().int().optional().nullable(),
  widthMm: z.coerce.number().int().optional().nullable(),
  thicknessMm: z.coerce.number().int().optional().nullable(),
  startedAt: z.coerce.date().optional().nullable(),
  status: z.nativeEnum(RiggingStatus).optional(),
  notes: z.string().optional().nullable(),
  rfidTagUid: z.string().trim().min(1).optional()
});

export const riggingGearCreateSchema = riggingGearBaseSchema;
export const riggingGearUpdateSchema = riggingGearBaseSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: '更新項目がありません'
});

export const riggingGearQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(RiggingStatus).optional()
});

export const riggingGearParamsSchema = z.object({
  id: z.string().uuid()
});

export const riggingTagCreateSchema = z.object({
  rfidTagUid: z.string().min(1)
});

export const riggingTagParamsSchema = z.object({
  tagId: z.string().uuid()
});

export const riggingInspectionRecordCreateSchema = z.object({
  riggingGearId: z.string().uuid(),
  loanId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid(),
  result: z.nativeEnum(InspectionResult),
  inspectedAt: z.coerce.date(),
  notes: z.string().optional().nullable()
});

export const riggingInspectionRecordQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  employeeId: z.string().uuid().optional(),
  result: z.nativeEnum(InspectionResult).optional()
});

export const riggingBorrowSchema = z.object({
  riggingTagUid: z.string().min(1).optional(),
  riggingGearId: z.string().uuid().optional(),
  employeeTagUid: z.string().min(1),
  clientId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
  note: z.string().optional().nullable()
});

export const riggingReturnSchema = z.object({
  loanId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  performedByUserId: z.string().uuid().optional(),
  note: z.string().optional().nullable()
});
