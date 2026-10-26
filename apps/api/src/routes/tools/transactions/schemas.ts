import { z } from 'zod';

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  employeeId: z.string().guid().optional(),
  itemId: z.string().guid().optional(),
  clientId: z.string().guid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional()
});

