import sharp from 'sharp';

import { env } from '../../config/env.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { prisma } from '../../lib/prisma.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import { requestJevChoice, type JevImageAsset } from '../typesafe/jev-choice-client.js';
import {
  decodePartMeasurementDrawingDimensionMapPayload,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION
} from './part-measurement-drawing-dimension-map-payload.js';
import { getPartMeasurementDrawingDimensionMapService } from './part-measurement-drawing-dimension-map.service.js';
import { getPartMeasurementDrawingOcrService } from './part-measurement-drawing-ocr.service.js';
import { drawingNameFamily } from './part-measurement-drawing-placement-transfer.js';
import {
  parseSiblingVisionResponse, prefilterDrawingSiblings, SIBLING_MATCH_VERSION, SIBLING_VISION_INSTRUCTIONS,
  type DrawingSibling
} from './part-measurement-drawing-sibling-match.js';

const defaultDeps = {
  vision: () => getInferenceRuntime().createMultiImageVisionCompletionPort(),
  enabled: () => env.INSPECTION_DRAWING_SIBLING_VISION_ENABLED,
  jevConfig: () => ({ enabled: env.INSPECTION_DRAWING_TRANSFER_JEV_ENABLED, apiKey: env.TYPESAFE_API_KEY,
    timeoutMs: env.INSPECTION_DRAWING_TRANSFER_JEV_TIMEOUT_MS }),
  requestJevChoice,
  readDrawing: (path: string) => PartMeasurementDrawingStorage.readDrawing(path)
};

export class PartMeasurementDrawingSiblingMatchService {
  constructor(
    private readonly deps = defaultDeps,
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
    const candidates = prefilterDrawingSiblings({ ...target, map }, decoded.flat());
    const row = await prisma.partMeasurementDrawingSiblingMatch.upsert({
      where, create: { ...key, status: 'PENDING', method: 'dgx-vision', siblings: [], attempts: 1 },
      update: { attempts: { increment: 1 } }
    });
    const finish = (siblings: DrawingSibling[], method: string, lastError: string | null = null) =>
      prisma.partMeasurementDrawingSiblingMatch.update({ where: { id: row.id }, data: {
        status: siblings.length ? 'MATCHED' : 'NO_MATCH', siblings, method, lastError
      } });
    const names = () => {
      const family = drawingNameFamily(target.name);
      return candidates.filter((candidate) => family && drawingNameFamily(candidate.name) === family)
        .map((candidate) => ({ visualTemplateId: candidate.id, confidence: 0.4 }));
    };
    if (!candidates.length || !this.deps.enabled()) return finish(names(), 'name');
    const pending = (error: unknown) => prisma.partMeasurementDrawingSiblingMatch.update({ where: { id: row.id }, data: {
      status: 'PENDING', method: 'dgx-vision', siblings: [], lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    } });
    const labels = candidates.map((_, index) => `candidate_${index + 1}`);
    let images: Array<{ label: string; imageBytes: Buffer; mimeType: 'image/jpeg' }> = [];
    let siblings: DrawingSibling[] | undefined;
    let failure: unknown;
    try {
      images = await Promise.all([target, ...candidates].map(async (visual, index) => ({
        label: index ? labels[index - 1] : 'target', mimeType: 'image/jpeg' as const,
        imageBytes: await sharp((await this.deps.readDrawing(visual.drawingImageRelativePath)).buffer)
          .flatten({ background: 'white' }).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 }).toBuffer()
      })));
      const { rawText } = await this.deps.vision().completeMany({
        images, background: true, jsonOutput: true, timeoutMs: 115_000, temperature: 0, maxTokens: 2000,
        userText: `${SIBLING_VISION_INSTRUCTIONS}\n各候補を必ず一度ずつ判定し、JSON のみで返してください: {"candidates":[{"label":"candidate_1","sameFamily":true,"confidence":0.9}]}。confidence は 0〜1。`
      });
      const parsed = parseSiblingVisionResponse(rawText, labels);
      siblings = parsed.filter((candidate) => candidate.sameFamily && candidate.confidence >= 0.5)
        .map((candidate) => ({ visualTemplateId: candidates[labels.indexOf(candidate.label)].id, confidence: candidate.confidence }))
        .sort((a, b) => b.confidence - a.confidence);
      const uncertain = !siblings.some((sibling) => sibling.confidence >= 0.7) &&
        parsed.some((candidate) => candidate.confidence >= 0.3 && candidate.confidence < 0.7);
      if (!uncertain) return finish(siblings, 'dgx-vision');
    } catch (error) {
      // A busy DGX is retried next tick; after three deferrals (e.g. DGX stopped) JEV decides instead.
      if (error instanceof InferenceDeferredError && row.attempts < 3) return pending(error);
      failure = error;
    }
    const jev = this.deps.jevConfig();
    if (jev.enabled && jev.apiKey?.trim() && images.length) {
      try {
        const assets: Record<string, JevImageAsset> = {};
        images.forEach((image) => { assets[image.label] = { type: 'image', format: 'jpeg', data_base64: image.imageBytes.toString('base64') }; });
        const criteria: Record<string, string> = { none: '同じ部品系列の候補はない' };
        labels.forEach((label) => { criteria[label] = `${label} が target と同じ部品系列`; });
        const probabilities = await this.deps.requestJevChoice({
          apiKey: jev.apiKey, timeoutMs: jev.timeoutMs, assets, criteria,
          state: { target: 'target', candidates: labels.join(', ') },
          instructions: `${SIBLING_VISION_INSTRUCTIONS}\n同じ部品系列の候補を一つ選んでください。該当がなければ none を選んでください。`
        });
        const chosen = Object.keys(criteria).sort((a, b) => probabilities[b] - probabilities[a])[0];
        return finish(chosen === 'none' ? [] : [{ visualTemplateId: candidates[labels.indexOf(chosen)].id, confidence: 0.7 }], 'jev-vision');
      } catch (error) { failure = error; }
    }
    // A valid, uncertain DGX answer remains usable if the fallback is unavailable.
    if (siblings) return finish(siblings, 'dgx-vision');
    if (row.attempts >= 3) return finish(names(), 'name', 'vision failed after 3 attempts');
    return pending(failure);
  }
}
