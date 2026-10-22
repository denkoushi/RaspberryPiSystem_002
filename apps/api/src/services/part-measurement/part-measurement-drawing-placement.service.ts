import { Prisma, type PartMeasurementProcessGroup, type PartMeasurementTemplateItem } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION } from './part-measurement-drawing-dimension-map-payload.js';
import { getPartMeasurementDrawingDimensionMapService } from './part-measurement-drawing-dimension-map.service.js';
import { getPartMeasurementDrawingOcrService } from './part-measurement-drawing-ocr.service.js';
import {
  chooseSourceSibling,
  placementItemAlreadyExists,
  transferItems,
  type DimensionMap,
  type PlacementExistingItem,
  type PlacementReorder,
  type PlacementSourceItem
} from './part-measurement-drawing-placement-transfer.js';

import { siblingMatchesSchema, SIBLING_MATCH_VERSION } from './part-measurement-drawing-sibling-match.js';
import { PartMeasurementDrawingSiblingMatchService } from './part-measurement-drawing-sibling-match.service.js';

export const PART_MEASUREMENT_DRAWING_PLACEMENT_VERSION = 'transfer-v2';
// The process is part of the version so the existing unique run key stays unchanged (expand-only migration).
export const placementVersionFor = (processGroup: PartMeasurementProcessGroup) =>
  `${PART_MEASUREMENT_DRAWING_PLACEMENT_VERSION}:${processGroup}`;
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
    private readonly dimensionMapService = getPartMeasurementDrawingDimensionMapService(),
    private readonly siblingMatchService = new PartMeasurementDrawingSiblingMatchService()
  ) {}

  async ensureRun(visualTemplateId: string, options: {
    processGroup: PartMeasurementProcessGroup; reorder?: PlacementReorder; reorderProvider?: PlacementReorderProvider | null
  }): Promise<EnsureRunResult> {
    const { drawingImageFingerprint } = await this.drawingOcrService.getCurrentStatus(visualTemplateId);
    const targetMap = await this.dimensionMapService.getCompletedPayload(visualTemplateId, drawingImageFingerprint);
    if (!targetMap) return { status: 'map-pending', run: null };
    const match = await prisma.partMeasurementDrawingSiblingMatch.findUnique({ where: {
      visualTemplateId_drawingImageFingerprint_matchVersion: {
        visualTemplateId, drawingImageFingerprint, matchVersion: SIBLING_MATCH_VERSION
      }
    } });
    if (!match || match.status === 'PENDING') return { status: 'map-pending', run: null };
    const key = {
      visualTemplateId,
      drawingImageFingerprint,
      analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
      placementVersion: placementVersionFor(options.processGroup)
    };
    const where = { visualTemplateId_drawingImageFingerprint_analysisVersion_placementVersion: key };
    const existingRun = await prisma.partMeasurementDrawingPlacementRun.findUnique({ where, include: runInclude });
    if (existingRun) return runResult(existingRun);
    const target = await prisma.partMeasurementVisualTemplate.findUnique({ where: { id: visualTemplateId } });
    if (!target) throw new ApiError(404, '図面テンプレートが見つかりません。');
    const siblings = match.status === 'MATCHED' ? siblingMatchesSchema.parse(match.siblings) : [];
    const visuals = siblings.length ? await prisma.partMeasurementVisualTemplate.findMany({
      where: { id: { in: siblings.map((sibling) => sibling.visualTemplateId) }, isActive: true },
      select: { id: true, name: true }
    }) : [];
    const siblingVisuals = siblings.flatMap((sibling) => visuals.filter((visual) => visual.id === sibling.visualTemplateId));
    const templates = siblingVisuals.length ? await prisma.partMeasurementTemplate.findMany({
      where: { visualTemplateId: { in: siblingVisuals.map((visual) => visual.id) }, isActive: true,
        processGroup: options.processGroup, items: { some: { markerXRatio: { not: null }, markerYRatio: { not: null } } } },
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
      existingItems: await this.existingItems(visualTemplateId, options.processGroup),
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

  private async existingItems(visualTemplateId: string, processGroup: PartMeasurementProcessGroup): Promise<PlacementExistingItem[]> {
    const items = await prisma.partMeasurementTemplateItem.findMany({
      where: { template: { visualTemplateId, isActive: true, processGroup } },
      select: { measurementLabel: true, nominalValue: true }
    });
    return items.map((item) => ({ measurementLabel: item.measurementLabel, nominalValue: numeric(item.nominalValue) }));
  }

  async listForEditor(visualTemplateId: string, processGroup: PartMeasurementProcessGroup): Promise<PartMeasurementDrawingPlacementEditorResult> {
    const result = await this.ensureRun(visualTemplateId, { processGroup });
    if (!result.run) return { status: result.status, sourceDrawingName: null, proposals: [], unplaced: [] };
    const existingItems = await this.existingItems(visualTemplateId, processGroup);
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
    const batchLimit = Math.max(1, Math.min(1000, Math.trunc(limit) || 1));
    const latestMaps = Prisma.sql`
      SELECT vt."id", m."drawingImageFingerprint", m."createdAt"
      FROM "PartMeasurementVisualTemplate" vt
      JOIN LATERAL (
        SELECT * FROM "PartMeasurementDrawingDimensionMap" m
        WHERE m."visualTemplateId" = vt."id" AND m."analysisVersion" = ${PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION}
        ORDER BY m."createdAt" DESC, m."id" ASC LIMIT 1
      ) m ON m."status" = 'COMPLETED'::"PartMeasurementDrawingDimensionMapStatus"
      WHERE vt."isActive" = TRUE
    `;
    const targets = await prisma.$queryRaw<Array<{ id: string }>>`
      WITH maps AS (${latestMaps})
      SELECT m."id" FROM maps m
      LEFT JOIN "PartMeasurementDrawingSiblingMatch" s ON s."visualTemplateId" = m."id"
        AND s."drawingImageFingerprint" = m."drawingImageFingerprint" AND s."matchVersion" = ${SIBLING_MATCH_VERSION}
      WHERE s."id" IS NULL OR s."status" = 'PENDING'::"PartMeasurementDrawingSiblingMatchStatus"
      ORDER BY COALESCE(s."updatedAt", m."createdAt") ASC, m."id" ASC LIMIT ${batchLimit}
    `;
    const counts = { scanned: targets.length, matched: 0, noMatch: 0, deferred: 0, jev: 0,
      ready: 0, noSibling: 0, mapPending: 0, failed: 0 };
    for (const target of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const match = await this.siblingMatchService.match(target.id);
        if (!match) counts.mapPending++;
        else if (match.status === 'PENDING') counts.deferred++;
        else if (match.status === 'MATCHED') counts.matched++;
        else counts.noMatch++;
        if (match?.method === 'jev-vision') counts.jev++;
      } catch (error) {
        counts.failed++;
        log.warn({ err: error, visualTemplateId: target.id }, 'drawing sibling match failed');
      }
    }
    const rows = await prisma.$queryRaw<Array<{ id: string; processGroup: PartMeasurementProcessGroup }>>`
      WITH maps AS (${latestMaps})
      SELECT m."id", p."processGroup" FROM maps m
      JOIN "PartMeasurementDrawingSiblingMatch" s ON s."visualTemplateId" = m."id"
        AND s."drawingImageFingerprint" = m."drawingImageFingerprint" AND s."matchVersion" = ${SIBLING_MATCH_VERSION}
      CROSS JOIN LATERAL (
        SELECT 'CUTTING'::"PartMeasurementProcessGroup" AS "processGroup" WHERE s."status" = 'NO_MATCH'
        UNION
        SELECT t."processGroup" FROM jsonb_array_elements(s."siblings") sibling
        JOIN "PartMeasurementVisualTemplate" v ON v."id" = sibling->>'visualTemplateId' AND v."isActive" = TRUE
        JOIN "PartMeasurementTemplate" t ON t."visualTemplateId" = v."id" AND t."isActive" = TRUE
        WHERE s."status" = 'MATCHED'
      ) p
      WHERE NOT EXISTS (
        SELECT 1 FROM "PartMeasurementDrawingPlacementRun" r WHERE r."visualTemplateId" = m."id"
          AND r."drawingImageFingerprint" = m."drawingImageFingerprint"
          AND r."analysisVersion" = ${PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION}
          AND r."placementVersion" = (${`${PART_MEASUREMENT_DRAWING_PLACEMENT_VERSION}:`}::text || p."processGroup"::text)
      )
      ORDER BY m."createdAt" ASC, m."id" ASC, p."processGroup" ASC LIMIT ${batchLimit}
    `;
    for (const row of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.ensureRun(row.id, { processGroup: row.processGroup, reorderProvider });
        if (result.status === 'ready') counts.ready++;
        else if (result.status === 'no-sibling') counts.noSibling++;
        else counts.mapPending++;
      } catch (error) {
        counts.failed++;
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
