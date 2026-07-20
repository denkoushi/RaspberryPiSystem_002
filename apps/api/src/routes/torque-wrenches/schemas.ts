import { z } from 'zod';
import { TORQUE_WRENCH_STORAGE_LOCATIONS } from '@raspi-system/shared-types';

const id = z.string().uuid();
const decimal = z.union([z.string().trim().min(1), z.number().finite()]);
const status = z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED']);

export const torqueWrenchIdParamsSchema = z.object({ id });

export const torqueWrenchListQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional().default(false)
});

export const torqueWrenchModelCreateSchema = z.object({
  manufacturer: z.string().trim().min(1).max(120),
  modelNumber: z.string().trim().min(1).max(120),
  torqueMinNm: decimal,
  torqueMaxNm: decimal,
  resolutionNm: decimal.nullable().optional(),
  communicationType: z.string().trim().min(1).max(80).optional(),
  outputProfile: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional()
});

export const torqueWrenchModelUpdateSchema = torqueWrenchModelCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  '更新項目がありません'
);

export const torqueWrenchProfileCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  managementNumber: z.string().trim().min(1).max(120),
  modelId: id,
  serialNumber: z.string().trim().min(1).max(120),
  storageLocation: z.enum(TORQUE_WRENCH_STORAGE_LOCATIONS),
  calibrationExpiryDate: z.coerce.date().nullable().optional(),
  status: status.optional()
});

export const torqueWrenchProfileUpdateSchema = torqueWrenchProfileCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  '更新項目がありません'
);

export const torqueWrenchSettingCreateSchema = z.object({
  lowerLimit: decimal,
  nominalTorque: decimal,
  upperLimit: decimal,
  unit: z.string().trim().min(1).max(40),
  effectiveAt: z.coerce.date().optional(),
  reason: z.string().trim().max(500).nullable().optional()
});

export const capabilityGroupCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nominalDiameter: z.string().trim().min(1).max(40),
  boltLengthMm: decimal,
  material: z.string().trim().min(1).max(80),
  strengthClass: z.string().trim().min(1).max(80),
  modelIds: z.array(id).min(1),
  isActive: z.boolean().optional()
});

export const capabilityGroupUpdateSchema = capabilityGroupCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  '更新項目がありません'
);

export const compatibleCapabilityGroupQuerySchema = z.object({
  nominalDiameter: z.string().trim().min(1).max(40),
  boltLengthMm: decimal.optional(),
  material: z.string().trim().min(1).max(80).optional(),
  strengthClass: z.string().trim().min(1).max(80).optional()
});

export const assemblyWorkSessionParamsSchema = z.object({ id });

export const torqueWrenchConfirmationCreateSchema = z.object({
  expectedTemplateBoltId: id,
  torqueWrenchProfileId: id,
  physicalDisplayConfirmed: z.literal(true)
});

export const agentTorqueRecordSchema = z.object({
  sourceEventKey: z.string().trim().min(1).max(160),
  expectedTemplateBoltId: id,
  confirmationId: id,
  serialNumber: z.string().trim().min(1).max(120),
  value: z.coerce.number().finite(),
  unit: z.string().trim().min(1).max(40),
  rawPayload: z.unknown(),
  deviceRecordedAt: z.coerce.date().nullable().optional(),
  deviceMemoryCounter: z.string().trim().max(120).nullable().optional(),
  deviceJudgement: z.string().trim().max(80).nullable().optional()
}).superRefine((value, ctx) => {
  if (!Object.prototype.hasOwnProperty.call(value, 'rawPayload')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rawPayload'], message: '原文payloadが必要です' });
  }
});

export const torqueOverrideRecordSchema = z.object({
  confirmationId: id,
  value: z.coerce.number().finite(),
  unit: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(1).max(500)
});
