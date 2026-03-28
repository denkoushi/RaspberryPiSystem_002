import cron from 'node-cron';

import { logger } from '../../../lib/logger.js';
import { env } from '../../../config/env.js';
import { LlamaServerVisionCompletionAdapter, isLocalLlmVisionConfigured } from '../../vision/llama-server-vision-completion.adapter.js';
import { PhotoStorageThumbnailReader } from './photo-storage-thumbnail-reader.adapter.js';
import { PrismaPhotoToolLabelRepository } from './prisma-photo-tool-label.repository.js';
import { PhotoToolLabelingService } from './photo-tool-labeling.service.js';

const log = logger.child({ component: 'photoToolLabelScheduler' });

export class PhotoToolLabelScheduler {
  private task: cron.ScheduledTask | null = null;
  private running = false;
  private readonly service: PhotoToolLabelingService;
  private readonly schedule: string;
  private readonly batchSize: number;
  private readonly staleMinutes: number;

  constructor(service?: PhotoToolLabelingService, opts?: { schedule?: string; batchSize?: number; staleMinutes?: number }) {
    this.schedule = opts?.schedule ?? env.PHOTO_TOOL_LABEL_CRON;
    this.batchSize = opts?.batchSize ?? env.PHOTO_TOOL_LABEL_BATCH_SIZE;
    this.staleMinutes = opts?.staleMinutes ?? env.PHOTO_TOOL_LABEL_STALE_MINUTES;
    this.service =
      service ??
      new PhotoToolLabelingService({
        repo: new PrismaPhotoToolLabelRepository(),
        thumbnailReader: new PhotoStorageThumbnailReader(),
        vision: new LlamaServerVisionCompletionAdapter(),
        isVisionConfigured: isLocalLlmVisionConfigured,
      });
  }

  start(): void {
    if (this.task) {
      return;
    }
    if (!cron.validate(this.schedule)) {
      log.warn({ schedule: this.schedule }, '[PhotoToolLabelScheduler] invalid cron, skip start');
      return;
    }
    this.task = cron.schedule(
      this.schedule,
      async () => {
        await this.runOnce().catch((error) => {
          log.error({ err: error }, '[PhotoToolLabelScheduler] run failed');
        });
      },
      { timezone: 'Asia/Tokyo', scheduled: true }
    );
    log.info({ schedule: this.schedule, batchSize: this.batchSize }, '[PhotoToolLabelScheduler] started');
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const staleBefore = new Date(Date.now() - this.staleMinutes * 60 * 1000);
      await this.service.runBatch({ batchSize: this.batchSize, staleBefore });
    } finally {
      this.running = false;
    }
  }
}

let instance: PhotoToolLabelScheduler | null = null;

export function getPhotoToolLabelScheduler(): PhotoToolLabelScheduler {
  if (!instance) {
    instance = new PhotoToolLabelScheduler();
  }
  return instance;
}
