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

export const cancelSchema = z.object({
  loanId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  performedByUserId: z.string().uuid().optional()
});

