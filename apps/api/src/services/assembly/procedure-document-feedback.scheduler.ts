import { env } from '../../config/env.js';
import { CronBatchJob } from '../../lib/cron-batch-job.js';
import { logger } from '../../lib/logger.js';
import { runProcedureDocumentFeedback } from './procedure-document-feedback.service.js';

const scheduler = new CronBatchJob({
  enabled: () => env.PROCEDURE_DOCUMENT_FEEDBACK_ENABLED === 'true',
  cron: () => env.PROCEDURE_DOCUMENT_FEEDBACK_CRON,
  run: runProcedureDocumentFeedback,
  onDone: result => logger.info(result, 'procedure_document_feedback_completed'),
  onError: (error, signal) => {
    if (!signal.aborted) logger.error({ error: error instanceof Error ? error.name : 'unknown' }, 'procedure_document_feedback_batch_failed');
  },
});
export const getProcedureDocumentFeedbackScheduler = () => scheduler;
