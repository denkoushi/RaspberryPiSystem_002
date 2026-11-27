import cron from 'node-cron';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { runProcedureDocumentFeedback } from './procedure-document-feedback.service.js';

class ProcedureDocumentFeedbackScheduler {
  private task: cron.ScheduledTask | null = null;
  private abort: AbortController | null = null;
  private active: Promise<void> | null = null;

  start() {
    if (this.task || env.PROCEDURE_DOCUMENT_FEEDBACK_ENABLED !== 'true') return;
    this.task = cron.schedule(env.PROCEDURE_DOCUMENT_FEEDBACK_CRON, () => {
      if (this.active) return;
      this.abort = new AbortController();
      const { signal } = this.abort;
      this.active = runProcedureDocumentFeedback(signal)
        .then(result => logger.info(result, 'procedure_document_feedback_completed'))
        .catch(error => {
          if (!signal.aborted) logger.error({ error: error instanceof Error ? error.name : 'unknown' }, 'procedure_document_feedback_batch_failed');
        })
        .finally(() => { this.active = null; this.abort = null; });
    }, { timezone: 'Asia/Tokyo' });
  }

  async stop() {
    this.task?.stop();
    this.task = null;
    this.abort?.abort();
    await this.active;
  }
}

const scheduler = new ProcedureDocumentFeedbackScheduler();
export const getProcedureDocumentFeedbackScheduler = () => scheduler;
