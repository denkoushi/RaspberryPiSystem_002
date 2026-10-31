import cron from 'node-cron';
import { z } from 'zod';

export const advisoryCheckEnvShape = {
  ADVISORY_CHECK_ENABLED: z.enum(['true', 'false']).default('false'),
  ADVISORY_CHECK_DIR: z.string().trim().min(1).default('/app/storage/security-review/advisories'),
  ADVISORY_CHECK_CRON: z.string().refine(value => cron.validate(value), 'Invalid advisory check cron').default('*/5 * * * *'),
} as const;
