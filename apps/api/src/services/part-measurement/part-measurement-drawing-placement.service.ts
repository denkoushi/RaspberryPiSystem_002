import { Prisma, type PartMeasurementTemplateItem } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION } from './part-measurement-drawing-dimension-map-payload.js';
import { getPartMeasurementDrawingDimensionMapService } from './part-measurement-drawing-dimension-map.service.js';
import { getPartMeasurementDrawingOcrService } from './part-measurement-drawing-ocr.service.js';
import {
  chooseSourceSibling,
  drawingNameFamily,
  placementItemAlreadyExists,
  transferItems,
  type DimensionMap,
  type PlacementExistingItem,
  type PlacementReorder,
  type PlacementSourceItem
} from './part-measurement-drawing-placement-transfer.js';

export const PART_MEASUREMENT_DRAWING_PLACEMENT_VERSION = 'transfer-v1';
export type PlacementReorderProvider = (
  visualTemplateId: string, source: { sourceVisualTemplateId: string; sourceMap: DimensionMap | null }
) =>
  PlacementReorder | null | Promise<PlacementReorder | null>;

// Like the existing OCR response, this API contract lives in the API package.
export type PartMeasurementDrawingPlacementEditorResult = {
  status: 'ready' | 'map-pending' | 'no-sibling';
  sourceDrawingName: string | null;
  proposals: {
    id: string;
    sortOrder: number;
    measurementLabel: string;
    measurementPoint: string | null;
    decimalPlaces: number;
    nominalValue: number;
    lowerLimit: number | null;
    upperLimit: number | null;
    depthMode: 'measured' | 'through';
    valueKind: 'numeric' | 'judgement';
    markerXRatio: number | null;
    markerYRatio: number | null;
    dimensionText: string | null;
  }[];
  unplaced: {
    id: string;
    measurementLabel: string;
    measurementPoint: string | null;
    decimalPlaces: number;
    nominalValue: number;
    lowerLimit: number | null;
    upperLimit: number | null;
    depthMode: 'measured' | 'through';
    valueKind: 'numeric' | 'judgement';
    reason: 'no-candidate';
  }[];
};

const runInclude = {
  sourceVisualTemplate: { select: { name: true } },
  proposals: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }
} satisfies Prisma.PartMeasurementDrawingPlacementRunInclude;
type PlacementRun = Prisma.PartMeasurementDrawingPlacementRunGetPayload<{ include: typeof runInclude }>;
type EnsureRunResult = { status: 'map-pending'; run: null } | { status: 'ready' | 'no-sibling'; run: PlacementRun };
const runResult = (run: PlacementRun): EnsureRunResult => ({
  status: run.sourceTemplateId === null ? 'no-sibling' : 'ready',
  run
});
const numeric = (value: Prisma.Decimal | null): number | null => value === null ? null : value.toNumber();
const log = logger.child({ component: 'partMeasurementDrawingPlacement' });

function sourceItems(items: PartMeasurementTemplateItem[]): PlacementSourceItem[] {
  return items.flatMap((item) => {
    if (item.markerXRatio === null || item.markerYRatio === null || item.nominalValue === null) return [];
    return [{
      id: item.id,
      sortOrder: item.sortOrder,
      measurementLabel: item.measurementLabel,
      nominalValue: item.nominalValue.toNumber(),
      lowerLimit: numeric(item.lowerLimit),
      upperLimit: numeric(item.upperLimit),
      depthMode: item.depthMode,
      valueKind: item.valueKind,
      markerXRatio: item.markerXRatio.toNumber(),
      markerYRatio: item.markerYRatio.toNumber(),
      calloutTipXRatio: numeric(item.calloutTipXRatio),
      calloutTipYRatio: numeric(item.calloutTipYRatio)
    }];
  });
}

export class PartMeasurementDrawingPlacementService {
  constructor(
    private readonly drawingOcrService = getPartMeasurementDrawingOcrService(),
    private readonly dimensionMapService = getPartMeasurementDrawingDimensionMapService()
  ) {}

  async ensureRun(visualTemplateId: string, options: {
    reorder?: PlacementReorder; reorderProvider?: PlacementReorderProvider | null
  } = {}): Promise<EnsureRunResult> {
    const { drawingImageFingerprint } = await this.drawingOcrService.getCurrentStatus(visualTemplateId);
    const targetMap = await this.dimensionMapService.getCompletedPayload(visualTemplateId, drawingImageFingerprint);
    if (!targetMap) return { status: 'map-pending', run: null };
    const key = {
      visualTemplateId,
      drawingImageFingerprint,
      analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
      placementVersion: PART_MEASUREMENT_DRAWING_PLACEMENT_VERSION
    };
    const where = { visualTemplateId_drawingImageFingerprint_analysisVersion_placementVersion: key };
    const existingRun = await prisma.partMeasurementDrawingPlacementRun.findUnique({ where, include: runInclude });
    if (existingRun) return runResult(existingRun);
    const target = await prisma.partMeasurementVisualTemplate.findUnique({ where: { id: visualTemplateId } });
    if (!target) throw new ApiError(404, '図面テンプレートが見つかりません。');
    const family = drawingNameFamily(target.name);
    const visuals = family ? await prisma.partMeasurementVisualTemplate.findMany({
      where: {
        id: { not: visualTemplateId }, isActive: true,
        businessTemplates: { some: { isActive: true, items: { some: { markerXRatio: { not: null }, markerYRatio: { not: null } } } } }
      },
      select: { id: true, name: true },
      orderBy: { id: 'asc' }
    }) : [];
    const siblingVisuals = visuals.filter((visual) => drawingNameFamily(visual.name) === family);
    const templates = siblingVisuals.length ? await prisma.partMeasurementTemplate.findMany({
      where: { visualTemplateId: { in: siblingVisuals.map((visual) => visual.id) }, isActive: true },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { id: 'asc' }
    }) : [];
    const source = chooseSourceSibling({
      target, targetMap,
      siblings: siblingVisuals.map((visual) => ({
        ...visual, isActive: true,
        templates: templates.filter((template) => template.visualTemplateId === visual.id)
          .map((template) => ({ ...template, items: sourceItems(template.items) }))
      }))
    });
    let sourceMap = null;
    if (source) {
      const status = await this.drawingOcrService.getCurrentStatus(source.sibling.id);
      sourceMap = await this.dimensionMapService.getCompletedPayload(source.sibling.id, status.drawingImageFingerprint);
    }
    const reorder = options.reorder ?? (source ? await options.reorderProvider?.(visualTemplateId, {
      sourceVisualTemplateId: source.sibling.id, sourceMap
    }) : undefined);
    const transfers = source ? await transferItems({
      targetMap,
      sourceMap,
      sourceItems: source.template.items,
      existingItems: await this.existingItems(visualTemplateId),
      reorder: reorder ?? undefined
    }) : [];
    const originalItems = new Map(templates.flatMap((template) => template.items).map((item) => [item.id, item]));
    try {
      // Nested creation is one transaction, including the unique run key and all its proposals.
      const run = await prisma.$transaction((tx) => tx.partMeasurementDrawingPlacementRun.create({
        data: {
          ...key,
          sourceVisualTemplateId: source?.sibling.id ?? null,
          sourceTemplateId: source?.template.id ?? null,
          rankingMethod: reorder ? 'jev' : 'position',
          proposalCount: transfers.filter((entry) => entry.status === 'PROPOSED').length,
          unplacedCount: transfers.filter((entry) => entry.status === 'UNPLACED').length,
          proposals: { create: transfers.map((entry) => {
            const original = originalItems.get(entry.item.id)!;
            return {
              visualTemplateId,
              sourceItemId: entry.item.id,
              status: entry.status,
              sortOrder: entry.item.sortOrder,
              measurementLabel: entry.item.measurementLabel,
              measurementPoint: original.measurementPoint,
              decimalPlaces: original.decimalPlaces,
              nominalValue: original.nominalValue!,
              lowerLimit: original.lowerLimit,
              upperLimit: original.upperLimit,
              depthMode: entry.item.depthMode,
              valueKind: entry.item.valueKind,
              markerXRatio: entry.markerXRatio,
              markerYRatio: entry.markerYRatio,
              dimension: entry.dimension ?? Prisma.DbNull,
              candidates: entry.candidates
            };
          }) }
        },
        include: runInclude
      }));
      return runResult(run);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await prisma.partMeasurementDrawingPlacementRun.findUnique({ where, include: runInclude });
        if (winner) return runResult(winner);
      }
      throw error;
    }
  }

  private async existingItems(visualTemplateId: string): Promise<PlacementExistingItem[]> {
    const items = await prisma.partMeasurementTemplateItem.findMany({
      where: { template: { visualTemplateId, isActive: true } },
      select: { measurementLabel: true, nominalValue: true }
    });
    return items.map((item) => ({ measurementLabel: item.measurementLabel, nominalValue: numeric(item.nominalValue) }));
  }

  async listForEditor(visualTemplateId: string): Promise<PartMeasurementDrawingPlacementEditorResult> {
    const result = await this.ensureRun(visualTemplateId);
    if (!result.run) return { status: result.status, sourceDrawingName: null, proposals: [], unplaced: [] };
    const existingItems = await this.existingItems(visualTemplateId);
    return {
      status: result.status,
      sourceDrawingName: result.run.sourceVisualTemplate?.name ?? null,
      proposals: result.run.proposals
        .filter((row) => row.status === 'PROPOSED' && !placementItemAlreadyExists({
          measurementLabel: row.measurementLabel, nominalValue: row.nominalValue.toNumber()
        }, existingItems))
        .map((row) => ({
          id: row.id, sortOrder: row.sortOrder, measurementLabel: row.measurementLabel,
          measurementPoint: row.measurementPoint, decimalPlaces: row.decimalPlaces,
          nominalValue: row.nominalValue.toNumber(), lowerLimit: numeric(row.lowerLimit), upperLimit: numeric(row.upperLimit),
          depthMode: row.depthMode === 'THROUGH' ? 'through' : 'measured',
          valueKind: row.valueKind === 'JUDGEMENT' ? 'judgement' : 'numeric',
          markerXRatio: numeric(row.markerXRatio), markerYRatio: numeric(row.markerYRatio),
          dimensionText: row.dimension && typeof row.dimension === 'object' && 'text' in row.dimension &&
            typeof row.dimension.text === 'string' ? row.dimension.text : null
        })),
      unplaced: result.run.proposals.filter((row) => row.status === 'UNPLACED').map((row) => ({
        id: row.id, measurementLabel: row.measurementLabel,
        measurementPoint: row.measurementPoint, decimalPlaces: row.decimalPlaces,
        nominalValue: row.nominalValue.toNumber(), lowerLimit: numeric(row.lowerLimit), upperLimit: numeric(row.upperLimit),
        depthMode: row.depthMode === 'THROUGH' ? 'through' : 'measured',
        valueKind: row.valueKind === 'JUDGEMENT' ? 'judgement' : 'numeric', reason: 'no-candidate'
      }))
    };
  }

  async recordDecisions(visualTemplateId: string, input: {
    approvedIds: string[]; rejectedIds: string[];
  }): Promise<{ updated: number }> {
    const decidedAt = new Date();
    // Approval wins if a caller supplies an ID in both lists. Only PROPOSED rows can transition.
    return prisma.$transaction(async (tx) => {
      const approved = await tx.partMeasurementDrawingPlacementProposal.updateMany({
        where: { visualTemplateId, id: { in: input.approvedIds }, status: 'PROPOSED' },
        data: { status: 'APPROVED', decidedAt }
      });
      const rejected = await tx.partMeasurementDrawingPlacementProposal.updateMany({
        where: { visualTemplateId, id: { in: input.rejectedIds }, status: 'PROPOSED' },
        data: { status: 'REJECTED', decidedAt }
      });
      return { updated: approved.count + rejected.count };
    });
  }

  async backfill(limit: number, reorderProvider: PlacementReorderProvider | null = null) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT vt."id"
      FROM "PartMeasurementVisualTemplate" vt
      WHERE vt."isActive" = TRUE AND EXISTS (
        SELECT 1 FROM "PartMeasurementDrawingDimensionMap" m
        WHERE m."visualTemplateId" = vt."id"
          AND m."analysisVersion" = ${PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION}
          AND m."status" = 'COMPLETED'::"PartMeasurementDrawingDimensionMapStatus"
          AND m."id" = (
            SELECT latest."id" FROM "PartMeasurementDrawingDimensionMap" latest
            WHERE latest."visualTemplateId" = vt."id" AND latest."analysisVersion" = m."analysisVersion"
            ORDER BY latest."createdAt" DESC, latest."id" ASC
            LIMIT 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM "PartMeasurementDrawingPlacementRun" r
            WHERE r."visualTemplateId" = vt."id"
              AND r."drawingImageFingerprint" = m."drawingImageFingerprint"
              AND r."analysisVersion" = m."analysisVersion"
              AND r."placementVersion" = ${PART_MEASUREMENT_DRAWING_PLACEMENT_VERSION}
          )
      )
      ORDER BY vt."updatedAt" DESC, vt."id" ASC
      LIMIT ${Math.max(1, Math.min(1000, Math.trunc(limit) || 1))}
    `;
    const counts = { scanned: rows.length, ready: 0, noSibling: 0, mapPending: 0, failed: 0 };
    for (const row of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.ensureRun(row.id, { reorderProvider });
        if (result.status === 'ready') counts.ready += 1;
        else if (result.status === 'no-sibling') counts.noSibling += 1;
        else counts.mapPending += 1;
      } catch (error) {
        counts.failed += 1;
        log.warn({ err: error, visualTemplateId: row.id }, 'drawing placement backfill failed');
      }
    }
    return counts;
  }
}

let instance: PartMeasurementDrawingPlacementService | null = null;
export function getPartMeasurementDrawingPlacementService(): PartMeasurementDrawingPlacementService {
  if (!instance) instance = new PartMeasurementDrawingPlacementService();
  return instance;
}
