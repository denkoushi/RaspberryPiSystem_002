import cron from 'node-cron';

import { logger } from '../../../lib/logger.js';
import { env } from '../../../config/env.js';
import { getInferenceRuntime } from '../../inference/inference-runtime.js';
import { getLocalLlmRuntimeController } from '../../inference/runtime/get-local-llm-runtime-controller.js';
import { createHttpPhotoToolImageEmbeddingAdapter } from './http-photo-tool-image-embedding.adapter.js';
import { PgPhotoToolSimilarityGalleryRepository } from './pg-photo-tool-similarity-gallery.repository.js';
import { PhotoToolLabelAssistService } from './photo-tool-label-assist.service.js';
import { PhotoStorageVisionImageSource } from './photo-storage-vision-image-source.adapter.js';
import { PrismaPhotoToolLabelRepository } from './prisma-photo-tool-label.repository.js';
import { PhotoToolLabelingService } from './photo-tool-labeling.service.js';

const log = logger.child({ component: 'photoToolLabelScheduler' });

export class PhotoToolLabelScheduler {
  private task: cron.ScheduledTask | null = null;
  /** 連続する runOnce を直列化し、写真登録直後のキックと cron が競合しても取りこぼさない */
  private runChain: Promise<void> = Promise.resolve();
  private readonly service: PhotoToolLabelingService;
  private readonly schedule: string;
  private readonly batchSize: number;
  private readonly staleMinutes: number;

  constructor(service?: PhotoToolLabelingService, opts?: { schedule?: string; batchSize?: number; staleMinutes?: number }) {
    this.schedule = opts?.schedule ?? env.PHOTO_TOOL_LABEL_CRON;
    this.batchSize = opts?.batchSize ?? env.PHOTO_TOOL_LABEL_BATCH_SIZE;
    this.staleMinutes = opts?.staleMinutes ?? env.PHOTO_TOOL_LABEL_STALE_MINUTES;
    if (service) {
      this.service = service;
    } else {
      const embeddingAdapter = createHttpPhotoToolImageEmbeddingAdapter();
      const galleryRepo = new PgPhotoToolSimilarityGalleryRepository(env.PHOTO_TOOL_EMBEDDING_DIMENSION);
      const labelAssist = new PhotoToolLabelAssistService(embeddingAdapter, galleryRepo);
      const inferenceRt = getInferenceRuntime();
      this.service = new PhotoToolLabelingService({
        repo: new PrismaPhotoToolLabelRepository(),
        visionImageSource: new PhotoStorageVisionImageSource(),
        vision: inferenceRt.createVisionCompletionPort(),
        isVisionConfigured: () => inferenceRt.isPhotoLabelInferenceConfigured(),
        labelAssist,
        shadowAssistEnabled: () =>
          env.PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED && env.PHOTO_TOOL_EMBEDDING_ENABLED,
        localLlmRuntime: getLocalLlmRuntimeController(),
      });
    }
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
    const staleBefore = new Date(Date.now() - this.staleMinutes * 60 * 1000);
    const work = this.runChain.then(async () => {
      await this.service.runBatch({ batchSize: this.batchSize, staleBefore });
    });
    this.runChain = work.catch((error) => {
      log.error({ err: error }, '[PhotoToolLabelScheduler] run failed');
    });
    await work;
  }
}

let instance: PhotoToolLabelScheduler | null = null;

export function getPhotoToolLabelScheduler(): PhotoToolLabelScheduler {
  if (!instance) {
    instance = new PhotoToolLabelScheduler();
  }
  return instance;
}
