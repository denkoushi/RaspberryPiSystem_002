import { Prisma, type PartMeasurementProcessGroup } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import type { TextCompletionPort } from '../inference/ports/text-completion.port.js';
import { InspectionDrawingMeasurementLabelSettingsService } from './inspection-drawing-measurement-label-settings.service.js';
import {
  decodePartMeasurementDrawingDimensionMapPayload, PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION
} from './part-measurement-drawing-dimension-map-payload.js';
import { getPartMeasurementDrawingDimensionMapService } from './part-measurement-drawing-dimension-map.service.js';
import { getPartMeasurementDrawingOcrService } from './part-measurement-drawing-ocr.service.js';
import type { DimensionMap } from './part-measurement-drawing-placement-transfer.js';
import { DRAWING_REFERENCE_GUIDE_TEXT, DRAWING_REFERENCE_LABEL_VOCABULARY } from './part-measurement-drawing-reference-guide.js';
import {
  buildReferenceExamples, buildReferenceMessages, DrawingReferenceResponseError, parseReferenceResponse, referenceProposalRows, selectReferenceExamples,
  type ReferenceExample
} from './part-measurement-drawing-reference-proposer.js';

export const referencePlacementVersionFor = (processGroup: PartMeasurementProcessGroup) => `reference-v1:${processGroup}`;
const runInclude = {
  sourceVisualTemplate: { select: { name: true } },
  proposals: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }
} satisfies Prisma.PartMeasurementDrawingPlacementRunInclude;

export async function proposeFromReference(input: {
  text: TextCompletionPort; target: DimensionMap; examples: ReferenceExample[]; labels: readonly string[];
  processGroup: PartMeasurementProcessGroup; signal?: AbortSignal; background?: boolean;
}) {
  input.signal?.throwIfAborted();
  const result = await input.text.complete({
    useCase: 'business_hermes',
    messages: buildReferenceMessages({ ...input, guideText: DRAWING_REFERENCE_GUIDE_TEXT }),
    maxTokens: 4000, temperature: 0, enableThinking: false, jsonOutput: true, background: input.background ?? true, signal: input.signal
  });
  input.signal?.throwIfAborted();
  return referenceProposalRows(parseReferenceResponse(result.rawText, input.target, input.labels), input.target);
}

export class PartMeasurementDrawingReferencePlacementService {
  constructor(
    private readonly text: TextCompletionPort = getInferenceRuntime().createTextCompletionPort(),
    private readonly drawingOcrService: Pick<ReturnType<typeof getPartMeasurementDrawingOcrService>, 'getCurrentFingerprint'> = getPartMeasurementDrawingOcrService(),
    private readonly dimensionMapService: Pick<ReturnType<typeof getPartMeasurementDrawingDimensionMapService>, 'getCompletedPayload'> = getPartMeasurementDrawingDimensionMapService(),
    private readonly labelSettingsService: Pick<InspectionDrawingMeasurementLabelSettingsService, 'listSettings'> = new InspectionDrawingMeasurementLabelSettingsService()
  ) {}

  private async runKey(visualTemplateId: string, processGroup: PartMeasurementProcessGroup) {
    const drawingImageFingerprint = await this.drawingOcrService.getCurrentFingerprint(visualTemplateId);
    return { visualTemplateId, drawingImageFingerprint, analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
      placementVersion: referencePlacementVersionFor(processGroup) };
  }

  async findRun(visualTemplateId: string, processGroup: PartMeasurementProcessGroup) {
    const key = await this.runKey(visualTemplateId, processGroup);
    return prisma.partMeasurementDrawingPlacementRun.findUnique({
      where: { visualTemplateId_drawingImageFingerprint_analysisVersion_placementVersion: key }, include: runInclude
    });
  }

  async ensureRun(visualTemplateId: string, processGroup: PartMeasurementProcessGroup, options: {
    signal?: AbortSignal; excludeVisualTemplateIds?: string[]; excludeMachinePrefix?: string | null;
  } = {}) {
    const key = await this.runKey(visualTemplateId, processGroup);
    const where = { visualTemplateId_drawingImageFingerprint_analysisVersion_placementVersion: key };
    const existing = await prisma.partMeasurementDrawingPlacementRun.findUnique({ where, include: runInclude });
    if (existing) return existing;
    const targetMap = await this.dimensionMapService.getCompletedPayload(visualTemplateId, key.drawingImageFingerprint);
    if (!targetMap) return null;
    const target = await prisma.partMeasurementVisualTemplate.findUnique({ where: { id: visualTemplateId }, select: { id: true, name: true } });
    if (!target) return null;
    const markedItems = { markerXRatio: { not: null }, markerYRatio: { not: null } };
    const visuals = await prisma.partMeasurementVisualTemplate.findMany({
      where: { isActive: true, id: { notIn: [visualTemplateId, ...(options.excludeVisualTemplateIds ?? [])] },
        businessTemplates: { some: { isActive: true, processGroup, items: { some: markedItems } } } },
      orderBy: { id: 'asc' },
      select: {
        id: true, name: true,
        dimensionMaps: { where: { analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 1,
          select: { status: true, drawingImageFingerprint: true, payloadCompressed: true, payloadEncoding: true } },
        businessTemplates: { where: { isActive: true, processGroup }, orderBy: { id: 'asc' },
          select: { items: { where: markedItems, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } }
      }
    });
    const candidates = (await Promise.all(visuals.map(async (visual) => {
      const latest = visual.dimensionMaps[0];
      if (latest?.status !== 'COMPLETED' || latest.drawingImageFingerprint === key.drawingImageFingerprint ||
        latest.payloadEncoding !== PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING || !latest.payloadCompressed) return [];
      try {
        const map = await decodePartMeasurementDrawingDimensionMapPayload(latest.payloadCompressed);
        const { picks } = buildReferenceExamples(map, visual.businessTemplates.flatMap((template) => template.items.map((item) => ({
          label: item.measurementLabel, nominalValue: item.nominalValue?.toNumber() ?? null,
          markerXRatio: item.markerXRatio?.toNumber() ?? null, markerYRatio: item.markerYRatio?.toNumber() ?? null
        }))));
        return [{ id: visual.id, name: visual.name, fingerprint: latest.drawingImageFingerprint, map, picks }];
      } catch { return []; }
    }))).flat();
    const examples = selectReferenceExamples({ ...target, fingerprint: key.drawingImageFingerprint, map: targetMap }, candidates, options);
    const settings = await this.labelSettingsService.listSettings();
    const labels = [...new Set([...settings, ...DRAWING_REFERENCE_LABEL_VOCABULARY].map(({ label }) => label.normalize('NFKC').trim()))];
    // An unusable answer is saved as an empty run so the nightly backfill does not pick the same drawing again.
    const proposals = await proposeFromReference({ text: this.text, target: targetMap, examples, labels, processGroup, signal: options.signal })
      .catch((error: unknown) => { if (error instanceof DrawingReferenceResponseError) return []; throw error; });
    options.signal?.throwIfAborted();
    try {
      return await prisma.$transaction((tx) => tx.partMeasurementDrawingPlacementRun.create({
        data: {
          ...key, rankingMethod: 'reference', sourceVisualTemplateId: null, sourceTemplateId: null,
          proposalCount: proposals.length, unplacedCount: 0,
          proposals: { create: proposals.map((row) => ({ ...row, visualTemplateId, status: 'PROPOSED', candidates: [] })) }
        }, include: runInclude
      }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await prisma.partMeasurementDrawingPlacementRun.findUnique({ where, include: runInclude });
        if (winner) return winner;
      }
      throw error;
    }
  }
}
