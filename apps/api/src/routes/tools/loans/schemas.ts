import { z } from 'zod';

export const borrowSchema = z.object({
  itemTagUid: z.string().min(4),
  employeeTagUid: z.string().min(4),
  clientId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
  note: z.string().optional().nullable()
});

export const returnSchema = z.object({
  loanId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  performedByUserId: z.string().uuid().optional(),
  note: z.string().optional().nullable()
});

export const activeLoanQuerySchema = z.object({
  clientId: z.string().uuid().optional()
});

export const loanParamsSchema = z.object({
  id: z.string().uuid()
});

export const assignLoanClientParamsSchema = z.object({
  id: z.string().uuid()
});

export const assignLoanClientBodySchema = z.object({
  clientId: z.string().uuid()
});

export const cancelSchema = z.object({
  loanId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  performedByUserId: z.string().uuid().optional()
});

export const photoLabelReviewListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const photoLabelReviewPatchBodySchema = z.object({
  quality: z.enum(['GOOD', 'MARGINAL', 'BAD']),
  /** 未送信のとき人による表示名は変更しない。null または空文字でクリア */
  humanDisplayName: z.union([z.string(), z.null()]).optional(),
});

