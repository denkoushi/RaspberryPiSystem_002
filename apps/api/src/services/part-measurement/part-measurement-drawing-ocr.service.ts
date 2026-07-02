import { createHash } from 'node:crypto';

import { Prisma, type PartMeasurementDrawingOcrCache } from '@prisma/client';

import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getImageOcrLayoutPort } from '../ocr/image-ocr-runtime.js';
import { PartMeasurementDrawingOcrEngine } from './part-measurement-drawing-ocr-engine.js';
import {
  decodePartMeasurementDrawingOcrPayload,
  encodePartMeasurementDrawingOcrPayload,
  PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_ENCODING,
  PART_MEASUREMENT_DRAWING_OCR_VERSION
} from './part-measurement-drawing-ocr-payload.js';
import {
  rankPartMeasurementDrawingOcrCandidates,
  type PartMeasurementDrawingOcrCandidate
} from './part-measurement-drawing-ocr-ranking.js';

const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH_SIZE = 1;
const log = logger.child({ component: 'partMeasurementDrawingOcr' });

type DrawingOcrStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type PartMeasurementDrawingOcrStatusSummary = {
  id: string;
  visualTemplateId: string;
  status: DrawingOcrStatus;
  ocrVersion: string;
  drawingImageFingerprint: string;
  engine: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  tokenCount: number;
  payloadBytes: number;
  attemptCount: number;
  failureReason: string | null;
  ocrStartedAt: string | null;
  ocrFinishedAt: string | null;
  nextAttemptAt: string | null;
  updatedAt: string;
};

export type PartMeasurementDrawingOcrCandidateResult = {
  status: DrawingOcrStatus;
  candidates: PartMeasurementDrawingOcrCandidate[];
  cache: PartMeasurementDrawingOcrStatusSummary;
};

function fingerprintDrawing(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function summarizeCache(cache: PartMeasurementDrawingOcrCache): PartMeasurementDrawingOcrStatusSummary {
  return {
    id: cache.id,
    visualTemplateId: cache.visualTemplateId,
    status: cache.status as DrawingOcrStatus,
    ocrVersion: cache.ocrVersion,
    drawingImageFingerprint: cache.drawingImageFingerprint,
    engine: cache.engine,
    imageWidth: cache.imageWidth,
    imageHeight: cache.imageHeight,
    tokenCount: cache.tokenCount,
    payloadBytes: cache.payloadBytes,
    attemptCount: cache.attemptCount,
    failureReason: cache.failureReason,
    ocrStartedAt: cache.ocrStartedAt?.toISOString() ?? null,
    ocrFinishedAt: cache.ocrFinishedAt?.toISOString() ?? null,
    nextAttemptAt: cache.nextAttemptAt?.toISOString() ?? null,
    updatedAt: cache.updatedAt.toISOString()
  };
}

function backoffAfterAttempt(attemptCount: number): Date {
  const seconds = Math.min(15 * 60, 30 * Math.max(1, 2 ** Math.max(0, attemptCount - 1)));
  return new Date(Date.now() + seconds * 1000);
}

export class PartMeasurementDrawingOcrService {
  constructor(
    private readonly engine = new PartMeasurementDrawingOcrEngine(getImageOcrLayoutPort())
  ) {}

  async enqueueVisualTemplate(
    visualTemplateId: string,
    options: { includeInactive?: boolean } = {}
  ): Promise<PartMeasurementDrawingOcrStatusSummary> {
    const visual = await prisma.partMeasurementVisualTemplate.findFirst({
      where: {
        id: visualTemplateId,
        ...(options.includeInactive ? {} : { isActive: true })
      }
    });
    if (!visual) {
      throw new ApiError(404, '図面テンプレートが見つかりません。');
    }
    const drawing = await PartMeasurementDrawingStorage.readDrawing(visual.drawingImageRelativePath);
    const fingerprint = fingerprintDrawing(drawing.buffer);

    const uniqueCacheKey = {
      visualTemplateId_ocrVersion_drawingImageFingerprint: {
        visualTemplateId,
        ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
        drawingImageFingerprint: fingerprint
      }
    };
    try {
      const cache = await prisma.partMeasurementDrawingOcrCache.upsert({
        where: uniqueCacheKey,
        create: {
          visualTemplateId,
          ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
          drawingImageFingerprint: fingerprint,
          status: 'PENDING'
        },
        update: {}
      });
      return summarizeCache(cache);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.partMeasurementDrawingOcrCache.findUnique({
          where: uniqueCacheKey
        });
        if (existing) return summarizeCache(existing);
      }
      throw error;
    }
  }

  async getCurrentStatus(visualTemplateId: string): Promise<PartMeasurementDrawingOcrStatusSummary> {
    return this.enqueueVisualTemplate(visualTemplateId);
  }

  async retryVisualTemplate(visualTemplateId: string): Promise<PartMeasurementDrawingOcrStatusSummary> {
    const summary = await this.enqueueVisualTemplate(visualTemplateId);
    const cache = await prisma.partMeasurementDrawingOcrCache.update({
      where: { id: summary.id },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        failureReason: null,
        nextAttemptAt: null,
        ocrStartedAt: null,
        ocrFinishedAt: null
      }
    });
    return summarizeCache(cache);
  }

  async getCandidates(
    visualTemplateId: string,
    input: {
      xRatio: number;
      yRatio: number;
      markerNo?: number | null;
      limit?: number;
    }
  ): Promise<PartMeasurementDrawingOcrCandidateResult> {
    const summary = await this.enqueueVisualTemplate(visualTemplateId);
    const cache = await prisma.partMeasurementDrawingOcrCache.findUnique({
      where: { id: summary.id }
    });
    if (!cache) {
      throw new ApiError(404, 'OCRキャッシュが見つかりません。');
    }
    if (cache.status !== 'COMPLETED') {
      return { status: cache.status as DrawingOcrStatus, candidates: [], cache: summarizeCache(cache) };
    }
    if (!cache.payloadCompressed || cache.payloadEncoding !== PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_ENCODING) {
      return { status: 'FAILED', candidates: [], cache: summarizeCache(cache) };
    }
    const payload = await decodePartMeasurementDrawingOcrPayload(cache.payloadCompressed);
    const candidates = rankPartMeasurementDrawingOcrCandidates(payload, input);
    return {
      status: 'COMPLETED',
      candidates,
      cache: summarizeCache(cache)
    };
  }

  async listVisualTemplateIdsForBackfill(options: {
    includeInactive?: boolean;
    visualTemplateId?: string;
    limit?: number;
  }): Promise<string[]> {
    const rows = await prisma.partMeasurementVisualTemplate.findMany({
      where: {
        ...(options.includeInactive ? {} : { isActive: true }),
        ...(options.visualTemplateId ? { id: options.visualTemplateId } : {})
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: { id: true },
      ...(options.limit ? { take: options.limit } : {})
    });
    return rows.map((row) => row.id);
  }

  async runBatch(options: { batchSize?: number } = {}): Promise<{ processed: number; failed: number }> {
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    let processed = 0;
    let failed = 0;
    for (let i = 0; i < batchSize; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const cache = await this.claimNextPending();
      if (!cache) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.processCache(cache);
        processed += 1;
      } catch (error) {
        failed += 1;
        log.warn({ err: error, cacheId: cache.id, visualTemplateId: cache.visualTemplateId }, 'drawing OCR cache failed');
      }
    }
    return { processed, failed };
  }

  private async claimNextPending(): Promise<PartMeasurementDrawingOcrCache | null> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "PartMeasurementDrawingOcrCache"
      SET
        "status" = 'PROCESSING'::"PartMeasurementDrawingOcrStatus",
        "ocrStartedAt" = NOW(),
        "lastAttemptAt" = NOW(),
        "attemptCount" = "attemptCount" + 1,
        "failureReason" = NULL,
        "updatedAt" = NOW()
      WHERE "id" = (
        SELECT "id"
        FROM "PartMeasurementDrawingOcrCache"
        WHERE
          "status" = 'PENDING'::"PartMeasurementDrawingOcrStatus"
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id"
    `;
    const id = rows[0]?.id;
    if (!id) return null;
    return prisma.partMeasurementDrawingOcrCache.findUnique({ where: { id } });
  }

  private async processCache(cache: PartMeasurementDrawingOcrCache): Promise<void> {
    try {
      const visual = await prisma.partMeasurementVisualTemplate.findUnique({
        where: { id: cache.visualTemplateId }
      });
      if (!visual) {
        throw new Error('visual template not found');
      }
      const drawing = await PartMeasurementDrawingStorage.readDrawing(visual.drawingImageRelativePath);
      const fingerprint = fingerprintDrawing(drawing.buffer);
      if (fingerprint !== cache.drawingImageFingerprint) {
        await this.markFailed(cache, new Error('drawing fingerprint changed before OCR'));
        await this.enqueueVisualTemplate(cache.visualTemplateId, { includeInactive: true });
        return;
      }

      const payload = await this.engine.run(drawing.buffer);
      const compressed = await encodePartMeasurementDrawingOcrPayload(payload);
      await prisma.partMeasurementDrawingOcrCache.update({
        where: { id: cache.id },
        data: {
          status: 'COMPLETED',
          payloadCompressed: compressed,
          payloadEncoding: PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_ENCODING,
          engine: payload.engine,
          imageWidth: payload.image.width,
          imageHeight: payload.image.height,
          tokenCount: payload.tokens.length,
          payloadBytes: compressed.length,
          ocrFinishedAt: new Date(),
          failureReason: null,
          nextAttemptAt: null
        }
      });
    } catch (error) {
      await this.markFailed(cache, error);
      throw error;
    }
  }

  private async markFailed(cache: PartMeasurementDrawingOcrCache, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const nextStatus: DrawingOcrStatus = cache.attemptCount >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
    const data: Prisma.PartMeasurementDrawingOcrCacheUpdateInput = {
      status: nextStatus,
      failureReason: message.slice(0, 2000),
      ocrFinishedAt: new Date(),
      nextAttemptAt: nextStatus === 'PENDING' ? backoffAfterAttempt(cache.attemptCount) : null
    };
    await prisma.partMeasurementDrawingOcrCache.update({
      where: { id: cache.id },
      data
    });
  }
}

let serviceInstance: PartMeasurementDrawingOcrService | null = null;

export function getPartMeasurementDrawingOcrService(): PartMeasurementDrawingOcrService {
  if (!serviceInstance) {
    serviceInstance = new PartMeasurementDrawingOcrService();
  }
  return serviceInstance;
}
