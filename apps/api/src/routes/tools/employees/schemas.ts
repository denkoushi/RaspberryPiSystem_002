import { z } from 'zod';
import pkg from '@prisma/client';

const { EmployeeStatus } = pkg;

export const employeeBodySchema = z.object({
  employeeCode: z.string().regex(/^\d{4}$/, '社員コードは数字4桁である必要があります（例: 0001）'),
  // 後方互換性のため、displayNameも受け入れる（優先度: lastName/firstName > displayName）
  displayName: z.string().min(1).optional(),
  lastName: z.string().min(1, '苗字は必須です').optional(),
  firstName: z.string().min(1, '名前は必須です').optional(),
  nfcTagUid: z.string().min(4).optional().or(z.literal('').transform(() => undefined)).nullable(),
  department: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  status: z.nativeEnum(EmployeeStatus).optional()
}).refine((data) => {
  // lastNameとfirstNameの両方が提供されているか、displayNameが提供されている必要がある
  const hasLastNameAndFirstName = data.lastName && data.firstName;
  const hasDisplayName = data.displayName && data.displayName.trim().length > 0;
  return hasLastNameAndFirstName || hasDisplayName;
}, {
  message: 'lastNameとfirstNameの両方、またはdisplayNameのいずれかが必要です'
});

// 更新時は既存データがあるため、lastName/firstNameの制約は不要
export const employeeUpdateSchema = z.object({
  employeeCode: z.string().regex(/^\d{4}$/, '社員コードは数字4桁である必要があります（例: 0001）').optional(),
  displayName: z.string().min(1).optional(),
  lastName: z.string().min(1, '苗字は必須です').optional(),
  firstName: z.string().min(1, '名前は必須です').optional(),
  nfcTagUid: z.string().min(4).optional().or(z.literal('').transform(() => undefined)).nullable(),
  department: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  status: z.nativeEnum(EmployeeStatus).optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: '更新項目がありません'
});

export const employeeQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(EmployeeStatus).optional()
});

export const employeeParamsSchema = z.object({
  id: z.string().uuid()
});

