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
const DEFAULT_STALE_PROCESSING_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.PART_MEASUREMENT_DRAWING_OCR_STALE_PROCESSING_MINUTES || '90', 10) || 90
);
const log = logger.child({ component: 'partMeasurementDrawingOcr' });

type DrawingOcrStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export const PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY = {
  BACKFILL_ACTIVE: 10,
  REFERENCED_ACTIVE: 50,
  USER_INITIATED: 100
} as const;

export type PartMeasurementDrawingOcrQueuePriority =
  (typeof PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY)[keyof typeof PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY];

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
  queuePriority: number;
  attemptCount: number;
  failureReason: string | null;
  ocrStartedAt: string | null;
  ocrFinishedAt: string | null;
  lastQueuedAt: string | null;
  nextAttemptAt: string | null;
  updatedAt: string;
};

export type PartMeasurementDrawingOcrCandidateResult = {
  status: DrawingOcrStatus;
  candidates: PartMeasurementDrawingOcrCandidate[];
  cache: PartMeasurementDrawingOcrStatusSummary;
};

export type PartMeasurementDrawingOcrBackfillTarget = {
  visualTemplateId: string;
  isReferencedByActiveTemplate: boolean;
  priority: number;
};

export type PartMeasurementDrawingOcrBackfillInspection = PartMeasurementDrawingOcrBackfillTarget & {
  cacheStatus: DrawingOcrStatus | 'MISSING';
  drawingImageFingerprint: string | null;
  failureReason: string | null;
};

export type PartMeasurementDrawingOcrBackfillDryRunSummary = {
  totalTargets: number;
  missing: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  unreadable: number;
  referencedByActiveTemplate: number;
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
    queuePriority: cache.queuePriority,
    attemptCount: cache.attemptCount,
    failureReason: cache.failureReason,
    ocrStartedAt: cache.ocrStartedAt?.toISOString() ?? null,
    ocrFinishedAt: cache.ocrFinishedAt?.toISOString() ?? null,
    lastQueuedAt: cache.lastQueuedAt?.toISOString() ?? null,
    nextAttemptAt: cache.nextAttemptAt?.toISOString() ?? null,
    updatedAt: cache.updatedAt.toISOString()
  };
}

function backoffAfterAttempt(attemptCount: number): Date {
  const seconds = Math.min(15 * 60, 30 * Math.max(1, 2 ** Math.max(0, attemptCount - 1)));
  return new Date(Date.now() + seconds * 1000);
}

function normalizeQueuePriority(priority: number | undefined): number {
  if (!Number.isFinite(priority)) return PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.BACKFILL_ACTIVE;
  return Math.max(0, Math.min(1000, Math.trunc(priority ?? 0)));
}

export class PartMeasurementDrawingOcrService {
  constructor(
    private readonly engine = new PartMeasurementDrawingOcrEngine(getImageOcrLayoutPort())
  ) {}

  async enqueueVisualTemplate(
    visualTemplateId: string,
    options: {
      includeInactive?: boolean;
      priority?: PartMeasurementDrawingOcrQueuePriority | number;
      resetFailed?: boolean;
    } = {}
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
    const now = new Date();
    const priority = normalizeQueuePriority(options.priority);
    try {
      const cache = await prisma.partMeasurementDrawingOcrCache.upsert({
        where: uniqueCacheKey,
        create: {
          visualTemplateId,
          ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
          drawingImageFingerprint: fingerprint,
          status: 'PENDING',
          queuePriority: priority,
          lastQueuedAt: now
        },
        update: {}
      });
      if ((cache.status === 'COMPLETED' || cache.status === 'FAILED') && options.resetFailed !== true) {
        return summarizeCache(cache);
      }
      return summarizeCache(await this.refreshQueuedCache(cache.id, priority, options.resetFailed === true));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.partMeasurementDrawingOcrCache.findUnique({
          where: uniqueCacheKey
        });
        if (existing) {
          if ((existing.status === 'COMPLETED' || existing.status === 'FAILED') && options.resetFailed !== true) {
            return summarizeCache(existing);
          }
          return summarizeCache(await this.refreshQueuedCache(existing.id, priority, options.resetFailed === true));
        }
      }
      throw error;
    }
  }

  private async refreshQueuedCache(
    cacheId: string,
    priority: number,
    resetFailed: boolean
  ): Promise<PartMeasurementDrawingOcrCache> {
    await prisma.$executeRaw`
      UPDATE "PartMeasurementDrawingOcrCache"
      SET
        "queuePriority" = GREATEST("queuePriority", ${priority}),
        "lastQueuedAt" = CASE
          WHEN "status" <> 'COMPLETED'::"PartMeasurementDrawingOcrStatus" THEN NOW()
          ELSE "lastQueuedAt"
        END,
        "status" = CASE
          WHEN ${resetFailed} AND "status" = 'FAILED'::"PartMeasurementDrawingOcrStatus"
            THEN 'PENDING'::"PartMeasurementDrawingOcrStatus"
          ELSE "status"
        END,
        "attemptCount" = CASE
          WHEN ${resetFailed} AND "status" = 'FAILED'::"PartMeasurementDrawingOcrStatus" THEN 0
          ELSE "attemptCount"
        END,
        "failureReason" = CASE
          WHEN ${resetFailed} AND "status" = 'FAILED'::"PartMeasurementDrawingOcrStatus" THEN NULL
          ELSE "failureReason"
        END,
        "nextAttemptAt" = CASE
          WHEN "status" = 'PENDING'::"PartMeasurementDrawingOcrStatus" THEN NULL
          WHEN ${resetFailed} AND "status" = 'FAILED'::"PartMeasurementDrawingOcrStatus" THEN NULL
          ELSE "nextAttemptAt"
        END,
        "ocrStartedAt" = CASE
          WHEN ${resetFailed} AND "status" = 'FAILED'::"PartMeasurementDrawingOcrStatus" THEN NULL
          ELSE "ocrStartedAt"
        END,
        "ocrFinishedAt" = CASE
          WHEN ${resetFailed} AND "status" = 'FAILED'::"PartMeasurementDrawingOcrStatus" THEN NULL
          ELSE "ocrFinishedAt"
        END,
        "updatedAt" = NOW()
      WHERE "id" = ${cacheId}
    `;
    const cache = await prisma.partMeasurementDrawingOcrCache.findUnique({ where: { id: cacheId } });
    if (!cache) {
      throw new ApiError(404, 'OCRキャッシュが見つかりません。');
    }
    return cache;
  }

  async getCurrentStatus(visualTemplateId: string): Promise<PartMeasurementDrawingOcrStatusSummary> {
    return this.enqueueVisualTemplate(visualTemplateId, {
      priority: PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.REFERENCED_ACTIVE
    });
  }

  async retryVisualTemplate(visualTemplateId: string): Promise<PartMeasurementDrawingOcrStatusSummary> {
    const summary = await this.enqueueVisualTemplate(visualTemplateId, {
      priority: PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.USER_INITIATED,
      resetFailed: true
    });
    const cache = await prisma.partMeasurementDrawingOcrCache.update({
      where: { id: summary.id },
      data: {
        status: 'PENDING',
        queuePriority: PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.USER_INITIATED,
        lastQueuedAt: new Date(),
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
    const summary = await this.enqueueVisualTemplate(visualTemplateId, {
      priority: PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.USER_INITIATED
    });
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
    const targets = await this.listVisualTemplateBackfillTargets(options);
    return targets.map((target) => target.visualTemplateId);
  }

  async listVisualTemplateBackfillTargets(options: {
    includeInactive?: boolean;
    visualTemplateId?: string;
    limit?: number;
  }): Promise<PartMeasurementDrawingOcrBackfillTarget[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
    const rows = await prisma.$queryRaw<
      Array<{ id: string; is_referenced_by_active_template: boolean; has_current_completed_cache: boolean }>
    >`
      SELECT
        vt."id",
        EXISTS (
          SELECT 1
          FROM "PartMeasurementTemplate" t
          WHERE t."visualTemplateId" = vt."id"
            AND t."isActive" = TRUE
        ) AS "is_referenced_by_active_template",
        EXISTS (
          SELECT 1
          FROM "PartMeasurementDrawingOcrCache" c
          WHERE c."visualTemplateId" = vt."id"
            AND c."ocrVersion" = ${PART_MEASUREMENT_DRAWING_OCR_VERSION}
            AND c."status" = 'COMPLETED'::"PartMeasurementDrawingOcrStatus"
        ) AS "has_current_completed_cache"
      FROM "PartMeasurementVisualTemplate" vt
      WHERE (${options.includeInactive === true} OR vt."isActive" = TRUE)
        AND (${options.visualTemplateId ?? null}::text IS NULL OR vt."id" = ${options.visualTemplateId ?? null})
      ORDER BY
        "has_current_completed_cache" ASC,
        "is_referenced_by_active_template" DESC,
        vt."updatedAt" DESC,
        vt."id" ASC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      visualTemplateId: row.id,
      isReferencedByActiveTemplate: row.is_referenced_by_active_template,
      priority: row.is_referenced_by_active_template
        ? PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.REFERENCED_ACTIVE
        : PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.BACKFILL_ACTIVE
    }));
  }

  async inspectBackfillTargets(options: {
    includeInactive?: boolean;
    visualTemplateId?: string;
    limit?: number;
  }): Promise<{
    targets: PartMeasurementDrawingOcrBackfillInspection[];
    summary: PartMeasurementDrawingOcrBackfillDryRunSummary;
  }> {
    const targets = await this.listVisualTemplateBackfillTargets(options);
    const inspected: PartMeasurementDrawingOcrBackfillInspection[] = [];
    const summary: PartMeasurementDrawingOcrBackfillDryRunSummary = {
      totalTargets: targets.length,
      missing: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      unreadable: 0,
      referencedByActiveTemplate: targets.filter((target) => target.isReferencedByActiveTemplate).length
    };

    for (const target of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const visual = await prisma.partMeasurementVisualTemplate.findUnique({
          where: { id: target.visualTemplateId },
          select: { drawingImageRelativePath: true }
        });
        if (!visual) {
          summary.unreadable += 1;
          inspected.push({ ...target, cacheStatus: 'MISSING', drawingImageFingerprint: null, failureReason: 'visual not found' });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const drawing = await PartMeasurementDrawingStorage.readDrawing(visual.drawingImageRelativePath);
        const fingerprint = fingerprintDrawing(drawing.buffer);
        // eslint-disable-next-line no-await-in-loop
        const cache = await prisma.partMeasurementDrawingOcrCache.findUnique({
          where: {
            visualTemplateId_ocrVersion_drawingImageFingerprint: {
              visualTemplateId: target.visualTemplateId,
              ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
              drawingImageFingerprint: fingerprint
            }
          }
        });
        const status = (cache?.status as DrawingOcrStatus | undefined) ?? 'MISSING';
        if (status === 'MISSING') summary.missing += 1;
        else if (status === 'PENDING') summary.pending += 1;
        else if (status === 'PROCESSING') summary.processing += 1;
        else if (status === 'COMPLETED') summary.completed += 1;
        else if (status === 'FAILED') summary.failed += 1;
        inspected.push({
          ...target,
          cacheStatus: status,
          drawingImageFingerprint: fingerprint,
          failureReason: cache?.failureReason ?? null
        });
      } catch (error) {
        summary.unreadable += 1;
        inspected.push({
          ...target,
          cacheStatus: 'MISSING',
          drawingImageFingerprint: null,
          failureReason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { targets: inspected, summary };
  }

  async discoverBackfillTargets(options: {
    includeInactive?: boolean;
    visualTemplateId?: string;
    limit?: number;
  }): Promise<{ discovered: number; queued: number; failed: number }> {
    const targets = await this.listVisualTemplateBackfillTargets(options);
    let queued = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const summary = await this.enqueueVisualTemplate(target.visualTemplateId, {
          includeInactive: options.includeInactive,
          priority: target.priority
        });
        if (summary.status !== 'COMPLETED') queued += 1;
      } catch (error) {
        failed += 1;
        log.warn(
          { err: error, visualTemplateId: target.visualTemplateId },
          'part_measurement_drawing_ocr_discover_enqueue_failed'
        );
      }
    }
    return { discovered: targets.length, queued, failed };
  }

  async runBatch(options: { batchSize?: number } = {}): Promise<{ processed: number; failed: number }> {
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    await this.requeueStaleProcessingCaches();
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
        ORDER BY
          "queuePriority" DESC,
          "lastQueuedAt" ASC NULLS LAST,
          "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id"
    `;
    const id = rows[0]?.id;
    if (!id) return null;
    return prisma.partMeasurementDrawingOcrCache.findUnique({ where: { id } });
  }

  private async requeueStaleProcessingCaches(): Promise<void> {
    const staleCutoff = new Date(Date.now() - DEFAULT_STALE_PROCESSING_MINUTES * 60 * 1000);
    const failed = await prisma.partMeasurementDrawingOcrCache.updateMany({
      where: {
        status: 'PROCESSING',
        attemptCount: { gte: MAX_ATTEMPTS },
        OR: [{ lastAttemptAt: { lt: staleCutoff } }, { ocrStartedAt: { lt: staleCutoff } }]
      },
      data: {
        status: 'FAILED',
        failureReason: 'OCR processing timed out',
        ocrFinishedAt: new Date(),
        nextAttemptAt: null
      }
    });
    const pending = await prisma.partMeasurementDrawingOcrCache.updateMany({
      where: {
        status: 'PROCESSING',
        attemptCount: { lt: MAX_ATTEMPTS },
        OR: [{ lastAttemptAt: { lt: staleCutoff } }, { ocrStartedAt: { lt: staleCutoff } }]
      },
      data: {
        status: 'PENDING',
        failureReason: 'OCR processing timed out; requeued',
        ocrFinishedAt: new Date(),
        nextAttemptAt: null,
        lastQueuedAt: new Date()
      }
    });
    if (failed.count > 0 || pending.count > 0) {
      log.warn(
        { failed: failed.count, requeued: pending.count, staleProcessingMinutes: DEFAULT_STALE_PROCESSING_MINUTES },
        'part_measurement_drawing_ocr_stale_processing_recovered'
      );
    }
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
