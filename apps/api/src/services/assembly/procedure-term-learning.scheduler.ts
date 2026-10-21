import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { runProcedureTermLearningOnce } from './procedure-term-learning.service.js';

export class ProcedureTermLearningScheduler {
  private task: cron.ScheduledTask | null = null;
  private abort: AbortController | null = null;
  private active: Promise<unknown> | null = null;
  start() {
    if (this.task || env.NODE_ENV === 'test' || env.ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED !== 'true') return;
    this.task = cron.schedule('30 4 * * *', () => {
      if (this.active) return;
      this.abort = new AbortController();
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(20 * 60_000)]);
      this.active = runProcedureTermLearningOnce({ signal })
        .then(results => logger.info({ results }, 'assembly_procedure_term_learning_completed'))
        .catch(error => logger.warn({ err: error }, 'assembly_procedure_term_learning_failed'))
        .finally(() => { this.active = null; this.abort = null; });
    }, { timezone: 'Asia/Tokyo' });
  }
  async stop() {
    this.task?.stop(); this.task = null;
    this.abort?.abort();
    await this.active;
  }
}
const scheduler = new ProcedureTermLearningScheduler();
export const getProcedureTermLearningScheduler = () => scheduler;
