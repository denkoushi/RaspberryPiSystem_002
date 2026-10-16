import cron from 'node-cron';

import { env } from '../../config/env.js';

import { logger } from '../../lib/logger.js';
import { getProcedureVideoProcessingService } from './procedure-video-processing.service.js';

// Started/stopped by the elected scheduler leader with the other post-listen jobs.
export class ProcedureVideoScheduler {
  private task: cron.ScheduledTask | null = null;
  start() {
    if (this.task) return;
    this.task = cron.schedule('* * * * *', () => { this.kick(); }, { timezone: 'Asia/Tokyo', scheduled: true });
  }
  stop() { this.task?.stop(); this.task = null; }
  kick() {
    if (env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED) {
      // 推論系の重い依存を読み込み時に連鎖させないよう、有効時だけ遅延 import する
      void import('./procedure-video-auto-edit.service.js').then(async ({ getProcedureVideoAutoEditService, recoverProcedureVideoAutoEdit }) => {
        await recoverProcedureVideoAutoEdit();
        await getProcedureVideoAutoEditService().runOnce();
      }).catch((error: unknown) => {
        logger.error({ err: error }, 'Procedure video auto edit failed');
      });
    }
    void getProcedureVideoProcessingService().runOnce().catch((error: unknown) => {
      logger.error({ err: error }, 'Procedure video processing failed');
    });
  }
}
let scheduler: ProcedureVideoScheduler | undefined;
export function getProcedureVideoScheduler() { return scheduler ??= new ProcedureVideoScheduler(); }
