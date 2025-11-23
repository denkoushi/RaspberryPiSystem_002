import { z } from 'zod';
import pkg from '@prisma/client';

const { EmployeeStatus } = pkg;

export const employeeBodySchema = z.object({
  employeeCode: z.string().min(1),
  displayName: z.string().min(1),
  nfcTagUid: z.string().min(4).optional().or(z.literal('').transform(() => undefined)).nullable(),
  department: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  status: z.nativeEnum(EmployeeStatus).optional()
});

export const employeeUpdateSchema = employeeBodySchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: '更新項目がありません'
});

export const employeeQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(EmployeeStatus).optional()
});

export const employeeParamsSchema = z.object({
  id: z.string().uuid()
});

