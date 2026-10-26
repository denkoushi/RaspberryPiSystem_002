import { z } from 'zod';
import pkg from '@prisma/client';

const { RiggingStatus, InspectionResult } = pkg;

export const riggingGearBaseSchema = z.object({
  name: z.string().min(1, '名称は必須です'),
  managementNumber: z.string().min(1, '管理番号は必須です'),
  idNum: z.preprocess((val) => {
    if (typeof val === 'string' && val.trim() === '') {
      return null;
    }
    return val;
  }, z.string().trim().min(1).optional().nullable()),
  storageLocation: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  maxLoadTon: z.coerce.number().optional().nullable(),
  lengthMm: z.coerce.number().int().optional().nullable(),
  widthMm: z.coerce.number().int().optional().nullable(),
  thicknessMm: z.coerce.number().int().optional().nullable(),
  startedAt: z.coerce.date().optional().nullable(),
  status: z.nativeEnum(RiggingStatus).optional(),
  notes: z.string().optional().nullable(),
  // 空文字は「タグ削除」を意味する
  rfidTagUid: z.union([z.string().trim().min(1), z.literal('')]).optional()
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
  id: z.string().guid()
});

export const riggingTagCreateSchema = z.object({
  rfidTagUid: z.string().min(1)
});

export const riggingTagParamsSchema = z.object({
  tagId: z.string().guid()
});

export const riggingInspectionRecordCreateSchema = z.object({
  riggingGearId: z.string().guid(),
  loanId: z.string().guid().optional().nullable(),
  employeeId: z.string().guid(),
  result: z.nativeEnum(InspectionResult),
  inspectedAt: z.coerce.date(),
  notes: z.string().optional().nullable()
});

export const riggingInspectionRecordQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  employeeId: z.string().guid().optional(),
  result: z.nativeEnum(InspectionResult).optional()
});

export const riggingBorrowSchema = z.object({
  riggingTagUid: z.string().min(1).optional(),
  riggingGearId: z.string().guid().optional(),
  employeeTagUid: z.string().min(1),
  clientId: z.string().guid().optional(),
  dueAt: z.coerce.date().optional(),
  note: z.string().optional().nullable()
});

export const riggingReturnSchema = z.object({
  loanId: z.string().guid(),
  clientId: z.string().guid().optional(),
  performedByUserId: z.string().guid().optional(),
  note: z.string().optional().nullable()
});

/** GET /rigging-gears/loan-analytics */
export const riggingLoanAnalyticsQuerySchema = z.object({
  periodFrom: z.coerce.date().optional(),
  periodTo: z.coerce.date().optional(),
  monthlyMonths: z.coerce.number().int().min(1).max(24).optional(),
  timeZone: z.enum(['Asia/Tokyo', 'UTC']).optional(),
  riggingGearId: z.string().guid().optional(),
});
