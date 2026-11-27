import cron from 'node-cron';
import { z } from 'zod';

export const procedureDocumentFeedbackEnvShape = {
  PROCEDURE_DOCUMENT_FEEDBACK_ENABLED: z.enum(['true', 'false']).default('false'),
  PROCEDURE_DOCUMENT_FEEDBACK_CRON: z.string().refine(value => cron.validate(value), 'Invalid procedure document feedback cron').default('50 2 * * *'),
  PROCEDURE_DOCUMENT_FEEDBACK_LOOKBACK_DAYS: z.coerce.number().int().positive().default(2),
  PROCEDURE_DOCUMENT_FEEDBACK_BATCH_LIMIT: z.coerce.number().int().positive().default(20),
};
