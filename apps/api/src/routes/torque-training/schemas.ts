import { z } from 'zod';

const id = z.string().uuid();
const decimal = z.union([z.string().trim().min(1), z.number().finite()]);

export const operatorContextSchema = z.object({ uid: z.string().trim().min(1).max(200) });

export const startTrainingSessionSchema = z.object({
  uid: z.string().trim().min(1).max(200),
  programVersionId: id,
  requestId: z.string().trim().min(1).max(160)
});

export const trainingSessionParamsSchema = z.object({ id });

export const trainingProgramInputSchema = z.object({
  code: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(160),
  nominalDiameter: z.string().trim().min(1).max(40),
  boltLengthMm: decimal,
  material: z.string().trim().min(1).max(80),
  strengthClass: z.string().trim().min(1).max(80),
  capabilityGroupId: id,
  nominalTorque: decimal,
  lowerLimit: decimal,
  upperLimit: decimal,
  unit: z.string().trim().min(1).max(40),
  jigConditionCode: z.string().trim().min(1).max(80),
  torqueWrenchProfileIds: z.array(id).max(20)
});

export const trainingProgramIdParamsSchema = z.object({ id });

export const trainingRevisionSchema = trainingProgramInputSchema.omit({ code: true });

export const trainingDeactivateSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const trainingWrenchConfirmationSchema = z.object({
  uid: z.string().trim().min(1).max(200),
  torqueWrenchProfileId: id
});

export const trainingWrenchPreparationSchema = z.object({
  uid: z.string().trim().min(1).max(200),
  torqueWrenchProfileId: id,
  requestId: z.string().trim().min(1).max(160),
  physicalSettingConfirmed: z.literal(true)
});

export const trainingCancelSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const trainingLeaseAcquireSchema = z.object({
  sessionId: id,
  confirmationId: id,
  requestId: z.string().trim().min(1).max(160)
});

export const trainingLeaseTakeoverSchema = trainingLeaseAcquireSchema.extend({
  physicalWrenchPresent: z.literal(true),
  reason: z.string().trim().min(1).max(500)
});

export const trainingLeaseTokenSchema = z.object({
  sessionId: id,
  leaseId: id,
  generation: z.number().int().positive(),
  reason: z.string().trim().max(500).nullable().optional()
});

export const trainingAgentAttemptSchema = z.object({
  sourceEventKey: z.string().trim().min(1).max(160),
  confirmationId: id,
  // Legacy torque-agent outbox rows predate this field. The service derives
  // it only from the session-scoped wrench confirmation when omitted.
  torqueWrenchProfileId: id.optional(),
  serialNumber: z.string().trim().min(1).max(120),
  value: z.union([z.string().trim().min(1), z.number().finite()]),
  unit: z.string().trim().min(1).max(40),
  deviceRecordedAt: z.coerce.date().nullable().optional(),
  deviceMemoryCounter: z.string().trim().max(120).nullable().optional(),
  deviceJudgement: z.string().trim().max(80).nullable().optional(),
  connectionLeaseId: id.nullable().optional(),
  connectionLeaseGeneration: z.number().int().positive().nullable().optional()
});

export const trainingExcludeSchema = z.object({ reason: z.string().trim().min(1).max(500) });

/** キオスク設定経路は画面ゲートではなく、各リクエストで共有PINを再検証する。 */
const torqueTrainingSettingsAccessPassword = z
  .string()
  .trim()
  .regex(/^\d{4}$/, '操作パスワードは4桁の数字で入力してください');

export const torqueTrainingSettingsSnapshotSchema = z.object({
  accessPassword: torqueTrainingSettingsAccessPassword
});

export const torqueTrainingSettingsProgramCreateSchema = z.object({
  accessPassword: torqueTrainingSettingsAccessPassword,
  program: trainingProgramInputSchema
});

export const torqueTrainingSettingsProgramRevisionSchema = z.object({
  accessPassword: torqueTrainingSettingsAccessPassword,
  revision: trainingRevisionSchema
});

export const torqueTrainingSettingsDeactivateSchema = z.object({
  accessPassword: torqueTrainingSettingsAccessPassword,
  reason: z.string().trim().min(1).max(500)
});

export const torqueTrainingSettingsExcludeSchema = z.object({
  accessPassword: torqueTrainingSettingsAccessPassword,
  reason: z.string().trim().min(1).max(500)
});
