import { z } from 'zod';
import { BackupConfigSchema } from '../../services/backup/backup-config.js';

const backupTargetKindSchema = z.enum([
  'database',
  'file',
  'directory',
  'csv',
  'image',
  'client-file',
  'client-directory',
]);

const backupProviderSchema = z.enum(['local', 'dropbox', 'gmail']);

const retentionSchema = z.object({
  days: z.number().int().positive().optional(),
  maxBackups: z.number().int().positive().optional(),
}).optional();

const storageSchema = z.object({
  provider: backupProviderSchema.optional(),
  providers: z.array(backupProviderSchema).optional(),
}).optional();

const metadataSchema = z.record(z.unknown()).optional();

const cronScheduleSchema = z.string().trim().min(1).max(100);

export const backupConfigHistoryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const backupConfigHistoryIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const backupConfigBodySchema = BackupConfigSchema;

export const addBackupTargetBodySchema = z.object({
  kind: backupTargetKindSchema,
  source: z.string().trim().min(1),
  schedule: cronScheduleSchema.optional(),
  enabled: z.boolean().optional(),
  storage: storageSchema,
  retention: retentionSchema,
  metadata: metadataSchema,
});

export const addBackupTargetFromTemplateBodySchema = z.object({
  templateId: z.string().trim().min(1),
  overrides: z.object({
    kind: backupTargetKindSchema.optional(),
    source: z.string().trim().min(1).optional(),
    schedule: cronScheduleSchema.optional(),
    enabled: z.boolean().optional(),
    storage: storageSchema,
    retention: retentionSchema,
    metadata: metadataSchema,
  }).optional(),
});

export const updateBackupTargetParamsSchema = z.object({
  index: z.coerce.number().int().min(0),
});

export const updateBackupTargetBodySchema = z.object({
  kind: backupTargetKindSchema.optional(),
  source: z.string().trim().min(1).optional(),
  schedule: cronScheduleSchema.optional(),
  enabled: z.boolean().optional(),
  storage: storageSchema,
  retention: retentionSchema,
  metadata: metadataSchema,
});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).max(4096).optional(),
  state: z.string().trim().min(1).max(512).optional(),
  error: z.string().trim().min(1).max(256).optional(),
}).superRefine((value, ctx) => {
  if (!value.error && !value.code) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Authorization code is required',
      path: ['code'],
    });
  }
});
