import { z } from 'zod';

export const borrowSchema = z.object({
  itemTagUid: z.string().min(4),
  employeeTagUid: z.string().min(4),
  clientId: z.string().guid().optional(),
  dueAt: z.coerce.date().optional(),
  note: z.string().optional().nullable()
});

export const returnSchema = z.object({
  loanId: z.string().guid(),
  clientId: z.string().guid().optional(),
  performedByUserId: z.string().guid().optional(),
  note: z.string().optional().nullable()
});

export const activeLoanQuerySchema = z.object({
  clientId: z.string().guid().optional()
});

export const loanParamsSchema = z.object({
  id: z.string().guid()
});

export const assignLoanClientParamsSchema = z.object({
  id: z.string().guid()
});

export const assignLoanClientBodySchema = z.object({
  clientId: z.string().guid()
});

export const cancelSchema = z.object({
  loanId: z.string().guid(),
  clientId: z.string().guid().optional(),
  performedByUserId: z.string().guid().optional()
});

export const photoLabelReviewListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const photoLabelReviewPatchBodySchema = z.object({
  quality: z.enum(['GOOD', 'MARGINAL', 'BAD']),
  /** 未送信のとき人による表示名は変更しない。null または空文字でクリア */
  humanDisplayName: z.union([z.string(), z.null()]).optional(),
});

