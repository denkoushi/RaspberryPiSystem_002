import { env } from '../../config/env.js';
import { CronBatchJob } from '../../lib/cron-batch-job.js';
import { logger } from '../../lib/logger.js';
import { runProcedureTermLearningOnce } from './procedure-term-learning.service.js';

export class ProcedureTermLearningScheduler extends CronBatchJob<unknown> {
  constructor() {
    super({
      enabled: () => env.NODE_ENV !== 'test' && env.ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED === 'true',
      cron: () => '30 4 * * *',
      run: signal => runProcedureTermLearningOnce({ signal }),
      onDone: results => logger.info({ results }, 'assembly_procedure_term_learning_completed'),
      onError: error => logger.warn({ err: error }, 'assembly_procedure_term_learning_failed'),
      timeoutMs: 60 * 60_000,
    });
  }
}
const scheduler = new ProcedureTermLearningScheduler();
export const getProcedureTermLearningScheduler = () => scheduler;
