import cron from 'node-cron';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { getProcedureMaterialImageDescriptionService } from './procedure-material-image-description.service.js';

class ProcedureMaterialImageDescriptionScheduler {
  private task: cron.ScheduledTask | null = null;
  private loggedSkip = false;
  private skipOnce() {
    if (this.loggedSkip) return;
    this.loggedSkip = true;
    logger.info('Procedure material image description scheduler skipped: disabled or unavailable');
  }
  start() {
    if (this.task) return;
    if (!env.PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_ENABLED || !cron.validate(env.PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_CRON)) {
      this.skipOnce(); return;
    }
    this.task = cron.schedule(env.PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_CRON, () => { void this.runOnce(); },
      { timezone: 'Asia/Tokyo', scheduled: true });
  }
  async runOnce() {
    try {
      await getProcedureMaterialImageDescriptionService().runBatch({ batchSize: env.PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_BATCH_SIZE });
    } catch { this.skipOnce(); }
  }
  stop() { this.task?.stop(); this.task = null; }
}

const scheduler = new ProcedureMaterialImageDescriptionScheduler();
export function getProcedureMaterialImageDescriptionScheduler() { return scheduler; }
