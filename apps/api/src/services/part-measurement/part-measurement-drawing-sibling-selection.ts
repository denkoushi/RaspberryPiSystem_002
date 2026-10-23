import sharp from 'sharp';

import { env } from '../../config/env.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import { requestJevChoice, type JevImageAsset } from '../typesafe/jev-choice-client.js';
import { drawingNameFamily } from './part-measurement-drawing-placement-transfer.js';
import {
  parseSiblingVisionResponse, SIBLING_VISION_INSTRUCTIONS, type DrawingSibling
} from './part-measurement-drawing-sibling-match.js';

export const drawingSiblingSelectionDeps = {
  vision: () => getInferenceRuntime().createMultiImageVisionCompletionPort(),
  enabled: () => env.INSPECTION_DRAWING_SIBLING_VISION_ENABLED,
  jevConfig: () => ({ enabled: env.INSPECTION_DRAWING_TRANSFER_JEV_ENABLED, apiKey: env.TYPESAFE_API_KEY,
    timeoutMs: env.INSPECTION_DRAWING_TRANSFER_JEV_TIMEOUT_MS }),
  requestJevChoice,
  readDrawing: (path: string) => PartMeasurementDrawingStorage.readDrawing(path)
};

export type DrawingSiblingSelection = {
  status: 'PENDING' | 'MATCHED' | 'NO_MATCH';
  method: 'dgx-vision' | 'jev-vision' | 'name';
  siblings: DrawingSibling[];
  lastError: string | null;
};

type Drawing = { id: string; name: string; drawingImageRelativePath: string };

// One production selection attempt. Only image reads/inference are performed; no database access.
export async function selectDrawingSiblings(
  target: Drawing, candidates: Drawing[], attempts: number, deps = drawingSiblingSelectionDeps
): Promise<DrawingSiblingSelection> {
  const finish = (siblings: DrawingSibling[], method: DrawingSiblingSelection['method'], lastError: string | null = null): DrawingSiblingSelection => ({
    status: siblings.length ? 'MATCHED' : 'NO_MATCH', siblings, method, lastError
  });
  const pending = (error: unknown): DrawingSiblingSelection => ({
    status: 'PENDING', method: 'dgx-vision', siblings: [],
    lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000)
  });
  const names = () => {
    const family = drawingNameFamily(target.name);
    return candidates.filter((candidate) => family && drawingNameFamily(candidate.name) === family)
      .map((candidate) => ({ visualTemplateId: candidate.id, confidence: 0.4 }));
  };
  if (!candidates.length || !deps.enabled()) return finish(names(), 'name');
  const labels = candidates.map((_, index) => `candidate_${index + 1}`);
  let images: Array<{ label: string; imageBytes: Buffer; mimeType: 'image/jpeg' }> = [];
  let siblings: DrawingSibling[] | undefined;
  let failure: unknown;
  try {
    images = await Promise.all([target, ...candidates].map(async (visual, index) => ({
      label: index ? labels[index - 1] : 'target', mimeType: 'image/jpeg' as const,
      imageBytes: await sharp((await deps.readDrawing(visual.drawingImageRelativePath)).buffer)
        .flatten({ background: 'white' }).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer()
    })));
    const { rawText } = await deps.vision().completeMany({
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
    // A busy DGX is retried once next tick; on the second deferral (e.g. DGX stopped) JEV decides instead.
    if (error instanceof InferenceDeferredError && attempts < 2) return pending(error);
    failure = error;
  }
  const jev = deps.jevConfig();
  if (jev.enabled && jev.apiKey?.trim() && images.length) {
    try {
      const assets: Record<string, JevImageAsset> = {};
      images.forEach((image) => { assets[image.label] = { type: 'image', format: 'jpeg', data_base64: image.imageBytes.toString('base64') }; });
      const criteria: Record<string, string> = { none: '同じ部品系列の候補はない' };
      labels.forEach((label) => { criteria[label] = `${label} が target と同じ部品系列`; });
      const probabilities = await deps.requestJevChoice({
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
  if (attempts >= 3) return finish(names(), 'name', 'vision failed after 3 attempts');
  return pending(failure);
}
