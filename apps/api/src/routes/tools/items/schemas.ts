import { z } from 'zod';
import pkg from '@prisma/client';

const { ItemStatus } = pkg;

export const baseItemSchema = z.object({
  itemCode: z.string().regex(/^TO\d{4}$/, '管理番号はTO + 数字4桁である必要があります（例: TO0001）'),
  name: z.string().min(1, '工具名は必須です'),
  description: z.string().optional().nullable(),
  nfcTagUid: z.string().min(4).optional().or(z.literal('').transform(() => undefined)).nullable(),
  category: z.string().optional().nullable(),
  storageLocation: z.string().optional().nullable(),
  status: z.nativeEnum(ItemStatus).optional(),
  notes: z.string().optional().nullable()
});

export const itemCreateSchema = baseItemSchema;
export const itemUpdateSchema = baseItemSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: '更新項目がありません'
});

export const itemQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(ItemStatus).optional()
});

export const itemParamsSchema = z.object({
  id: z.string().uuid()
});

