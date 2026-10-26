import cron from 'node-cron';
import { z } from 'zod';

export const securityReviewEnvShape = {
  SECURITY_REVIEW_NIGHTLY_ENABLED: z.enum(['true', 'false']).default('false'),
  SECURITY_REVIEW_DATA_DIR: z.string().trim().min(1).default('/app/storage/security-review'),
  SECURITY_REVIEW_NIGHTLY_CRON: z.string().refine(value => cron.validate(value), 'Invalid security review cron').default('0 6 * * *'),
  SECURITY_REVIEW_RETRY_UNTIL: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('06:55'),
} as const;
