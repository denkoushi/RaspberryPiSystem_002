import cron from 'node-cron';

import { logger } from '../../lib/logger.js';
import { KioskDocumentAlertService } from './kiosk-document-alert.service.js';
import { PdfToTextExtractorAdapter } from './adapters/pdftotext-extractor.adapter.js';
import { NdlOcrEngineAdapter } from './adapters/ndlocr-engine.adapter.js';
import { PostgresDocumentSearchIndexerAdapter } from './adapters/postgres-document-search-indexer.adapter.js';
import { PrismaKioskDocumentRepository } from './adapters/prisma-kiosk-document.repository.js';
import { RegexMetadataLabelerAdapter } from './adapters/regex-metadata-labeler.adapter.js';
import { KioskDocumentProcessingService } from './kiosk-document-processing.service.js';
import { KioskDocumentService } from './kiosk-document.service.js';
import { PdfStorageFileStoreAdapter } from './adapters/pdf-storage-file-store.adapter.js';
import { PdfStorageRenderAdapter } from './adapters/pdf-storage-render.adapter.js';

const DEFAULT_SCHEDULE = process.env.KIOSK_DOCUMENT_OCR_CRON || '30 2 * * *';
const DEFAULT_BATCH_SIZE = parseInt(process.env.KIOSK_DOCUMENT_OCR_BATCH_SIZE || '100', 10);

export class KioskDocumentOcrScheduler {
  private task: cron.ScheduledTask | null = null;
  private running = false;
  private readonly service: KioskDocumentService;
  private readonly processingService: KioskDocumentProcessingService;
  private readonly alertService: KioskDocumentAlertService;

  constructor(
    service?: KioskDocumentService,
    processingService?: KioskDocumentProcessingService,
    alertService?: KioskDocumentAlertService
  ) {
    this.service =
      service ??
      new KioskDocumentService(
        new PrismaKioskDocumentRepository(),
        new PdfStorageFileStoreAdapter(),
        new PdfStorageRenderAdapter()
      );
    this.processingService =
      processingService ??
      new KioskDocumentProcessingService(
        new PrismaKioskDocumentRepository(),
        new PdfToTextExtractorAdapter(),
        new NdlOcrEngineAdapter(),
        new RegexMetadataLabelerAdapter(),
        new PostgresDocumentSearchIndexerAdapter()
      );
    this.alertService = alertService ?? new KioskDocumentAlertService();
  }

  async start(): Promise<void> {
    if (this.task) return;
    if (!cron.validate(DEFAULT_SCHEDULE)) {
      logger.warn({ schedule: DEFAULT_SCHEDULE }, '[KioskDocumentOcrScheduler] invalid cron, skip start');
      return;
    }
    this.task = cron.schedule(
      DEFAULT_SCHEDULE,
      async () => {
        await this.runOnce().catch(async (error) => {
          logger.error({ err: error }, '[KioskDocumentOcrScheduler] run failed');
          await this.alertService.notifyBatchFailure(error instanceof Error ? error.message : String(error));
        });
      },
      { timezone: 'Asia/Tokyo', scheduled: true }
    );
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.service.listPendingProcessing(DEFAULT_BATCH_SIZE);
      for (const doc of pending) {
        try {
          // FIFO / 1並列
          // eslint-disable-next-line no-await-in-loop
          await this.processingService.processDocumentById(doc.id, { maxRetry: 1 });
        } catch (error) {
          logger.warn({ err: error, documentId: doc.id }, '[KioskDocumentOcrScheduler] document process failed');
          // eslint-disable-next-line no-await-in-loop
          await this.alertService.notifyPermanentFailure(doc.id, error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      this.running = false;
    }
  }
}

let instance: KioskDocumentOcrScheduler | null = null;

export function getKioskDocumentOcrScheduler(): KioskDocumentOcrScheduler {
  if (!instance) {
    instance = new KioskDocumentOcrScheduler();
  }
  return instance;
}
