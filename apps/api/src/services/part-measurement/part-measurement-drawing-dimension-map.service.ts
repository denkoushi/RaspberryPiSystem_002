import { createHash } from 'node:crypto';

import { Prisma, type PartMeasurementDrawingDimensionMap } from '@prisma/client';

import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import type { VisionCompletionPort } from '../inference/ports/vision-completion.port.js';

import {
  buildDimensionMapTilePrompt,
  mergeDuplicateDimensions,
  parseDimensionMapTileResponse,
  toDrawingDimensions
} from './part-measurement-drawing-dimension-map-parse.js';
import {
  decodePartMeasurementDrawingDimensionMapPayload,
  encodePartMeasurementDrawingDimensionMapPayload,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
  type PartMeasurementDrawingDimension,
  type PartMeasurementDrawingDimensionMapPayload,
  type PartMeasurementDrawingDimensionMapTile
} from './part-measurement-drawing-dimension-map-payload.js';
import { renderDimensionMapTiles } from './part-measurement-drawing-dimension-map-tiling.js';

const MAX_ATTEMPTS = 3;
const TILE_MAX_TOKENS = 5000;
/** DGX ゲートウェイの上限 120 秒より少し短くする。 */
const TILE_TIMEOUT_MS = 115_000;
const DEFERRED_RETRY_MINUTES = 30;
const STALE_PROCESSING_MINUTES = 120;
const log = logger.child({ component: 'partMeasurementDrawingDimensionMap' });

export function isPartMeasurementDrawingDimensionMapEnabled(): boolean {
  return process.env.PART_MEASUREMENT_DRAWING_DIMENSION_MAP_ENABLED === 'true';
}

export type PartMeasurementDrawingDimensionMapBatchResult = {
  processed: number;
  failed: number;
  deferred: boolean;
};

export type PartMeasurementDrawingDimensionMapDeps = {
  vision: () => VisionCompletionPort;
  isVisionConfigured: () => boolean;
};

function fingerprintDrawing(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function backoffAfterAttempt(attemptCount: number): Date {
  const seconds = Math.min(60 * 60, 5 * 60 * Math.max(1, 2 ** Math.max(0, attemptCount - 1)));
  return new Date(Date.now() + seconds * 1000);
}

const defaultDeps: PartMeasurementDrawingDimensionMapDeps = {
  vision: () => getInferenceRuntime().createVisionCompletionPort(),
  isVisionConfigured: () => getInferenceRuntime().isPhotoLabelInferenceConfigured()
};

export type PartMeasurementDrawingDimensionMapSummary = {
  status: 'completed' | 'none';
  dimensionCount: number;
  finishedAt: string | null;
};

export class PartMeasurementDrawingDimensionMapService {
  constructor(private readonly deps: PartMeasurementDrawingDimensionMapDeps = defaultDeps) {}

  /** 現行の図面画像（指紋一致）で完成している寸法マップの要約。無ければ none。 */
  async getCompletedSummary(
    visualTemplateId: string,
    drawingImageFingerprint: string
  ): Promise<PartMeasurementDrawingDimensionMapSummary> {
    const row = await prisma.partMeasurementDrawingDimensionMap.findFirst({
      where: this.completedWhere(visualTemplateId, drawingImageFingerprint),
      select: { dimensionCount: true, finishedAt: true }
    });
    if (!row) return { status: 'none', dimensionCount: 0, finishedAt: null };
    return { status: 'completed', dimensionCount: row.dimensionCount, finishedAt: row.finishedAt?.toISOString() ?? null };
  }

  /** 現行の図面画像で完成している寸法マップの中身。無ければ null。 */
  async getCompletedPayload(
    visualTemplateId: string,
    drawingImageFingerprint: string
  ): Promise<PartMeasurementDrawingDimensionMapPayload | null> {
    const row = await prisma.partMeasurementDrawingDimensionMap.findFirst({
      where: this.completedWhere(visualTemplateId, drawingImageFingerprint),
      select: { payloadCompressed: true, payloadEncoding: true }
    });
    if (!row?.payloadCompressed || row.payloadEncoding !== PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING) {
      return null;
    }
    try {
      const payload = await decodePartMeasurementDrawingDimensionMapPayload(row.payloadCompressed);
      if (!Array.isArray(payload.dimensions) || !payload.image) return null;
      return payload;
    } catch (error) {
      // 壊れた寸法マップは無いものとして扱い、呼び出し側は OCR 候補に落とす。
      log.warn({ visualTemplateId, err: error }, 'drawing dimension map payload unreadable');
      return null;
    }
  }

  private completedWhere(
    visualTemplateId: string,
    drawingImageFingerprint: string
  ): Prisma.PartMeasurementDrawingDimensionMapWhereInput {
    return {
      visualTemplateId,
      analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
      drawingImageFingerprint,
      status: 'COMPLETED'
    };
  }

  /** 現行の図面画像に対する寸法マップ行を用意する（既にあれば何もしない）。 */
  async enqueueVisualTemplate(visualTemplateId: string): Promise<PartMeasurementDrawingDimensionMap | null> {
    const visual = await prisma.partMeasurementVisualTemplate.findUnique({
      where: { id: visualTemplateId },
      select: { drawingImageRelativePath: true }
    });
    if (!visual) return null;
    const drawing = await PartMeasurementDrawingStorage.readDrawing(visual.drawingImageRelativePath);
    const uniqueKey = {
      visualTemplateId_analysisVersion_drawingImageFingerprint: {
        visualTemplateId,
        analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
        drawingImageFingerprint: fingerprintDrawing(drawing.buffer)
      }
    };
    try {
      return await prisma.partMeasurementDrawingDimensionMap.upsert({
        where: uniqueKey,
        create: { ...uniqueKey.visualTemplateId_analysisVersion_drawingImageFingerprint, status: 'PENDING' },
        update: {}
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return prisma.partMeasurementDrawingDimensionMap.findUnique({ where: uniqueKey });
      }
      throw error;
    }
  }

  /** 現行版の寸法マップが完了していない有効な図面を、稼働中テンプレートが参照するものから順に登録する。 */
  async discoverTargets(options: { limit?: number } = {}): Promise<{ discovered: number; queued: number; failed: number }> {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT vt."id"
      FROM "PartMeasurementVisualTemplate" vt
      WHERE vt."isActive" = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM "PartMeasurementDrawingDimensionMap" m
          WHERE m."visualTemplateId" = vt."id"
            AND m."analysisVersion" = ${PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION}
            AND m."status" = 'COMPLETED'::"PartMeasurementDrawingDimensionMapStatus"
        )
      ORDER BY
        EXISTS (
          SELECT 1
          FROM "PartMeasurementTemplate" t
          WHERE t."visualTemplateId" = vt."id"
            AND t."isActive" = TRUE
        ) DESC,
        vt."updatedAt" DESC,
        vt."id" ASC
      LIMIT ${limit}
    `;
    let queued = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const map = await this.enqueueVisualTemplate(row.id);
        if (map && map.status === 'PENDING') queued += 1;
      } catch (error) {
        failed += 1;
        log.warn({ err: error, visualTemplateId: row.id }, 'part_measurement_drawing_dimension_map_enqueue_failed');
      }
    }
    return { discovered: rows.length, queued, failed };
  }

  /** DGX が混雑（429/503）を返したら、その図面を戻してバッチを止める。 */
  async runBatch(options: { batchSize?: number; signal?: AbortSignal } = {}): Promise<PartMeasurementDrawingDimensionMapBatchResult> {
    const result: PartMeasurementDrawingDimensionMapBatchResult = { processed: 0, failed: 0, deferred: false };
    if (!this.deps.isVisionConfigured()) return result;
    const batchSize = Math.max(1, options.batchSize ?? 1);
    await this.recoverStaleProcessing();
    for (let i = 0; i < batchSize && !options.signal?.aborted; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const map = await this.claimNextPending();
      if (!map) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.processMap(map, options.signal);
        result.processed += 1;
      } catch (error) {
        if (error instanceof InferenceDeferredError || options.signal?.aborted) {
          // eslint-disable-next-line no-await-in-loop
          await this.markDeferred(map);
          result.deferred = true;
          break;
        }
        result.failed += 1;
        // eslint-disable-next-line no-await-in-loop
        await this.markFailed(map, error);
        log.warn({ err: error, mapId: map.id, visualTemplateId: map.visualTemplateId }, 'part_measurement_drawing_dimension_map_failed');
      }
    }
    return result;
  }

  private async claimNextPending(): Promise<PartMeasurementDrawingDimensionMap | null> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "PartMeasurementDrawingDimensionMap"
      SET
        "status" = 'PROCESSING'::"PartMeasurementDrawingDimensionMapStatus",
        "startedAt" = NOW(),
        "lastAttemptAt" = NOW(),
        "attemptCount" = "attemptCount" + 1,
        "failureReason" = NULL,
        "updatedAt" = NOW()
      WHERE "id" = (
        SELECT "id"
        FROM "PartMeasurementDrawingDimensionMap"
        WHERE
          "status" = 'PENDING'::"PartMeasurementDrawingDimensionMapStatus"
          AND "analysisVersion" = ${PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION}
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id"
    `;
    const id = rows[0]?.id;
    if (!id) return null;
    return prisma.partMeasurementDrawingDimensionMap.findUnique({ where: { id } });
  }

  private async recoverStaleProcessing(): Promise<void> {
    const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);
    await prisma.partMeasurementDrawingDimensionMap.updateMany({
      where: { status: 'PROCESSING', attemptCount: { gte: MAX_ATTEMPTS }, lastAttemptAt: { lt: staleCutoff } },
      data: { status: 'FAILED', failureReason: 'dimension map processing timed out', finishedAt: new Date(), nextAttemptAt: null }
    });
    await prisma.partMeasurementDrawingDimensionMap.updateMany({
      where: { status: 'PROCESSING', attemptCount: { lt: MAX_ATTEMPTS }, lastAttemptAt: { lt: staleCutoff } },
      data: { status: 'PENDING', failureReason: 'dimension map processing timed out; requeued', nextAttemptAt: null }
    });
  }

  private async processMap(map: PartMeasurementDrawingDimensionMap, signal?: AbortSignal): Promise<void> {
    const visual = await prisma.partMeasurementVisualTemplate.findUnique({
      where: { id: map.visualTemplateId },
      select: { drawingImageRelativePath: true }
    });
    if (!visual) throw new Error('visual template not found');
    const drawing = await PartMeasurementDrawingStorage.readDrawing(visual.drawingImageRelativePath);
    if (fingerprintDrawing(drawing.buffer) !== map.drawingImageFingerprint) {
      throw new Error('drawing fingerprint changed before dimension map');
    }

    const { image, tiles } = await renderDimensionMapTiles(drawing.buffer);
    const prompt = buildDimensionMapTilePrompt(tiles.length);
    const vision = this.deps.vision();
    const tileResults: PartMeasurementDrawingDimensionMapTile[] = [];
    const dimensions: PartMeasurementDrawingDimension[] = [];
    for (const tile of tiles) {
      let status: PartMeasurementDrawingDimensionMapTile['status'] = 'ok';
      let tileDimensions: PartMeasurementDrawingDimension[] = [];
      try {
        // eslint-disable-next-line no-await-in-loop
        const { rawText } = await vision.complete({
          userText: prompt,
          imageBytes: tile.jpeg,
          mimeType: 'image/jpeg',
          maxTokens: TILE_MAX_TOKENS,
          temperature: 0,
          background: true,
          jsonOutput: true,
          timeoutMs: TILE_TIMEOUT_MS,
          signal
        });
        const rows = parseDimensionMapTileResponse(rawText);
        if (rows) tileDimensions = toDrawingDimensions(rows, tile);
        else status = 'parse_failed';
      } catch (error) {
        if (error instanceof InferenceDeferredError || signal?.aborted) throw error;
        status = 'failed';
        log.warn({ err: error, mapId: map.id, tileId: tile.id }, 'part_measurement_drawing_dimension_map_tile_failed');
      }
      dimensions.push(...tileDimensions);
      tileResults.push({ id: tile.id, box: tile.box, status, dimensionCount: tileDimensions.length });
    }

    const tileFailedCount = tileResults.filter((tile) => tile.status !== 'ok').length;
    if (tiles.length === 0 || tileFailedCount === tiles.length) {
      throw new Error(`dimension map: all ${tiles.length} tiles failed`);
    }
    const payload: PartMeasurementDrawingDimensionMapPayload = {
      schemaVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_SCHEMA_VERSION,
      analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
      createdAt: new Date().toISOString(),
      image,
      tiles: tileResults,
      dimensions: mergeDuplicateDimensions(dimensions, image)
    };
    await prisma.partMeasurementDrawingDimensionMap.update({
      where: { id: map.id },
      data: {
        status: 'COMPLETED',
        payloadCompressed: await encodePartMeasurementDrawingDimensionMapPayload(payload),
        payloadEncoding: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING,
        imageWidth: image.width,
        imageHeight: image.height,
        dimensionCount: payload.dimensions.length,
        tileCount: tiles.length,
        tileFailedCount,
        finishedAt: new Date(),
        failureReason: null,
        nextAttemptAt: null
      }
    });
  }

  private async markDeferred(map: PartMeasurementDrawingDimensionMap): Promise<void> {
    await prisma.partMeasurementDrawingDimensionMap.update({
      where: { id: map.id },
      data: {
        status: 'PENDING',
        attemptCount: Math.max(0, map.attemptCount - 1),
        failureReason: 'deferred: DGX busy',
        nextAttemptAt: new Date(Date.now() + DEFERRED_RETRY_MINUTES * 60 * 1000)
      }
    });
  }

  private async markFailed(map: PartMeasurementDrawingDimensionMap, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const failed = map.attemptCount >= MAX_ATTEMPTS;
    await prisma.partMeasurementDrawingDimensionMap.update({
      where: { id: map.id },
      data: {
        status: failed ? 'FAILED' : 'PENDING',
        failureReason: message.slice(0, 2000),
        finishedAt: new Date(),
        nextAttemptAt: failed ? null : backoffAfterAttempt(map.attemptCount)
      }
    });
  }
}

let serviceInstance: PartMeasurementDrawingDimensionMapService | null = null;

export function getPartMeasurementDrawingDimensionMapService(): PartMeasurementDrawingDimensionMapService {
  if (!serviceInstance) {
    serviceInstance = new PartMeasurementDrawingDimensionMapService();
  }
  return serviceInstance;
}
