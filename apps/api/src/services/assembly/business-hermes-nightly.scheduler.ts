import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { BusinessHermesNightlyService } from './business-hermes-nightly.service.js';

// A failed batch usually needs a person (for example, a protected reference
// source changed). Retrying every minute re-ran the whole batch about 6,000
// times from 2026-09-22 and left ~58 GB of job files, so failures back off:
// 15, 30, 60 ... up to 360 minutes, reset by the next batch that does not fail.
export function failureBackoffMinutes(consecutiveFailures: number): number {
  return Math.min(15 * 2 ** Math.max(consecutiveFailures - 1, 0), 360);
}

export class BusinessHermesNightlyScheduler {
  private task: cron.ScheduledTask | null = null;
  private abort: AbortController | null = null;
  private active: Promise<unknown> | null = null;
  private nextCheck = 0;
  private consecutiveFailures = 0;
  private backOffAfterFailure() {
    this.consecutiveFailures += 1;
    this.nextCheck = Date.now() + failureBackoffMinutes(this.consecutiveFailures) * 60_000;
  }
  start() {
    if (this.task || env.BUSINESS_HERMES_NIGHTLY_ENABLED !== 'true') return;
    if (!env.BUSINESS_HERMES_NIGHTLY_DATA_DIR || !env.BUSINESS_HERMES_ANSWER_CACHE_URL || !env.BUSINESS_HERMES_ANSWER_CACHE_TOKEN) throw new Error('Incomplete Hermes nightly configuration');
    const background = env.BUSINESS_HERMES_BACKGROUND_ENABLED === 'true';
    this.task = cron.schedule(background ? '* * * * *' : '0 3 * * *', () => {
      if (this.active || Date.now() < this.nextCheck) return;
      this.abort = new AbortController();
      const stopped = this.abort.signal;
      this.active = (async () => {
        do {
          const signal = AbortSignal.any([stopped, AbortSignal.timeout(20 * 60_000)]);
          const result = await new BusinessHermesNightlyService().run(signal);
          logger.info({ runId: result.runId, status: result.status, documentProgress: result.documentProgress, adoptedFacts: result.activated ? result.sourceFacts?.newFacts : 0, adoptedQuestions: result.activated ? result.sourceFacts?.newQuestions : 0 }, 'Hermes improvement batch completed');
          if (['failed', 'interrupted'].includes(result.status)) {
            this.backOffAfterFailure();
            break;
          }
          this.consecutiveFailures = 0;
          if (['no_work', 'already_running', 'deferred'].includes(result.status)) {
            this.nextCheck = Date.now() + (result.status === 'no_work' ? 15 : 1) * 60_000;
            break;
          }
          if (background && !result.preparedDocuments) {
            this.nextCheck = Date.now() + 15 * 60_000;
            break;
          }
        } while (background && !stopped.aborted);
      })()
        .catch(error => {
          this.backOffAfterFailure();
          logger.error({ error: error instanceof Error ? error.name : 'unknown', retryInMinutes: failureBackoffMinutes(this.consecutiveFailures) }, 'Hermes nightly check failed');
        })
        .finally(() => { this.active = null; this.abort = null; });
    }, { timezone: 'Asia/Tokyo' });
  }
  async stop() {
    this.task?.stop(); this.task = null;
    this.abort?.abort();
    await this.active;
  }
}
const scheduler = new BusinessHermesNightlyScheduler();
export const getBusinessHermesNightlyScheduler = () => scheduler;
