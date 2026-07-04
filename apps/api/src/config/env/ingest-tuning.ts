import { z } from 'zod';

export const ingestTuningEnvShape = {
  // Gmail trash cleanup (processed label in trash -> hard delete)
  GMAIL_TRASH_CLEANUP_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ),
  GMAIL_TRASH_CLEANUP_CRON: z.string().default('0 3 * * *'),
  GMAIL_TRASH_CLEANUP_LABEL: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).default('rps_processed')
  ),
  DUE_MGMT_TUNING_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ).transform((v) => v === 'true'),
  DUE_MGMT_TUNING_CRON: z.string().default('15 2 * * *'),
  DUE_MGMT_TUNING_LOCATIONS: z.string().default('shared-global-rank'),
  DUE_MGMT_TUNING_IMPROVEMENT_STREAK_REQUIRED: z.coerce.number().int().min(1).max(14).default(2),
  DUE_MGMT_TUNING_MAX_WEIGHT_DELTA: z.coerce.number().min(0.01).max(0.5).default(0.08),
  DUE_MGMT_TUNING_EXCLUDED_DATES: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),
  DUE_MGMT_TUNING_EXCLUDE_WEEKENDS: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ).transform((v) => v === 'true'),
} as const;
