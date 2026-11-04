import { prisma } from '../../lib/prisma.js';
import {
  decodePartMeasurementDrawingDimensionMapPayload,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION
} from './part-measurement-drawing-dimension-map-payload.js';
import { getPartMeasurementDrawingDimensionMapService } from './part-measurement-drawing-dimension-map.service.js';
import { getPartMeasurementDrawingOcrService } from './part-measurement-drawing-ocr.service.js';
import {
  prefilterDrawingSiblings, SIBLING_MATCH_VERSION
} from './part-measurement-drawing-sibling-match.js';

import { drawingSiblingSelectionDeps, selectDrawingSiblings } from './part-measurement-drawing-sibling-selection.js';

export class PartMeasurementDrawingSiblingMatchService {
  constructor(
    private readonly deps = drawingSiblingSelectionDeps,
    private readonly drawingOcrService = getPartMeasurementDrawingOcrService(),
    private readonly dimensionMapService = getPartMeasurementDrawingDimensionMapService()
  ) {}

  async match(visualTemplateId: string) {
    const { drawingImageFingerprint } = await this.drawingOcrService.getCurrentStatus(visualTemplateId);
    const map = await this.dimensionMapService.getCompletedPayload(visualTemplateId, drawingImageFingerprint);
    if (!map) return null;
    const key = { visualTemplateId, drawingImageFingerprint, matchVersion: SIBLING_MATCH_VERSION };
    const where = { visualTemplateId_drawingImageFingerprint_matchVersion: key };
    const existing = await prisma.partMeasurementDrawingSiblingMatch.findUnique({ where });
    if (existing && existing.status !== 'PENDING') return existing;
    const target = await prisma.partMeasurementVisualTemplate.findUniqueOrThrow({ where: { id: visualTemplateId } });
    // Fetch compressed maps together; never issue a per-candidate DB request.
    const visuals = await prisma.partMeasurementVisualTemplate.findMany({
      where: { id: { not: visualTemplateId }, isActive: true,
        businessTemplates: { some: { isActive: true, items: { some: { markerXRatio: { not: null }, markerYRatio: { not: null } } } } } },
      select: { id: true, name: true, drawingImageRelativePath: true, dimensionMaps: {
        where: { analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 1,
        select: { status: true, payloadCompressed: true, payloadEncoding: true }
      } }
    });
    const decoded = await Promise.all(visuals.map(async (visual) => {
      const latest = visual.dimensionMaps[0];
      if (latest?.status !== 'COMPLETED' || !latest.payloadCompressed ||
        latest.payloadEncoding !== PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING) return [];
      try {
        const payload = await decodePartMeasurementDrawingDimensionMapPayload(latest.payloadCompressed);
        return Array.isArray(payload.dimensions) && payload.image ? [{ ...visual, map: payload }] : [];
      } catch { return []; }
    }));
    const row = await prisma.partMeasurementDrawingSiblingMatch.upsert({
      where, create: { ...key, status: 'PENDING', method: 'dgx-vision', siblings: [], attempts: 1 },
      update: { attempts: { increment: 1 } }
    });
    const pool = decoded.flat();
    let candidates: typeof pool = [];
    try {
      if (this.deps.enabled()) candidates = await prefilterDrawingSiblings(target, pool, this.deps);
    } catch (error) {
      // An unreadable target image is recorded like a failed vision attempt instead of being re-picked forever.
      return prisma.partMeasurementDrawingSiblingMatch.update({ where: { id: row.id }, data: {
        status: row.attempts >= 3 ? 'NO_MATCH' : 'PENDING', method: 'dgx-vision', siblings: [],
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000)
      } });
    }
    const decision = await selectDrawingSiblings(target, candidates, row.attempts, this.deps);
    return prisma.partMeasurementDrawingSiblingMatch.update({ where: { id: row.id }, data: decision });
  }
}
