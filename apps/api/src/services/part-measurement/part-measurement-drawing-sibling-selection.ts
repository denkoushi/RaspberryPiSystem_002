import sharp from 'sharp';

import { env } from '../../config/env.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import {
  parseSiblingVisionResponse, SIBLING_SHAPE_THRESHOLD, SIBLING_VISION_INSTRUCTIONS, type DrawingSibling
} from './part-measurement-drawing-sibling-match.js';

export const drawingSiblingSelectionDeps = {
  vision: () => getInferenceRuntime().createMultiImageVisionCompletionPort(),
  enabled: () => env.INSPECTION_DRAWING_SIBLING_VISION_ENABLED,
  candidateLimit: () => env.INSPECTION_DRAWING_SIBLING_CANDIDATE_LIMIT,
  readDrawing: (path: string) => PartMeasurementDrawingStorage.readDrawing(path)
};

export type DrawingSiblingSelection = {
  status: 'PENDING' | 'MATCHED' | 'NO_MATCH';
  method: 'dgx-vision';
  siblings: DrawingSibling[];
  lastError: string | null;
};

type Drawing = { id: string; name: string; drawingImageRelativePath: string };

// One production selection attempt. Only image reads/inference are performed; no database access.
export async function selectDrawingSiblings(
  target: Drawing, candidates: Drawing[], attempts: number, deps = drawingSiblingSelectionDeps
): Promise<DrawingSiblingSelection> {
  const result: DrawingSiblingSelection = { status: 'NO_MATCH', method: 'dgx-vision', siblings: [], lastError: null };
  if (!candidates.length || !deps.enabled()) return result;
  const image = async (drawing: Drawing, label: string) => ({
    label, mimeType: 'image/jpeg' as const,
    imageBytes: await sharp((await deps.readDrawing(drawing.drawingImageRelativePath)).buffer)
      .flatten({ background: 'white' }).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer()
  });
  const failed = (error: unknown): DrawingSiblingSelection => ({
    ...result, siblings: [], status: error instanceof InferenceDeferredError || attempts < 3 ? 'PENDING' : 'NO_MATCH',
    lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000)
  });
  let targetImage;
  try { targetImage = await image(target, 'target'); } catch (error) { return failed(error); }
  let completed = 0;
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const candidateImage = await image(candidate, 'candidate_1');
      // eslint-disable-next-line no-await-in-loop
      const { rawText } = await deps.vision().completeMany({
        images: [targetImage, candidateImage], background: true, jsonOutput: true,
        timeoutMs: 115_000, temperature: 0, maxTokens: 600, userText: SIBLING_VISION_INSTRUCTIONS
      });
      const { shapeSimilarity } = parseSiblingVisionResponse(rawText);
      completed++;
      if (shapeSimilarity >= SIBLING_SHAPE_THRESHOLD) result.siblings.push({ visualTemplateId: candidate.id, confidence: shapeSimilarity });
    } catch (error) {
      if (error instanceof InferenceDeferredError) return failed(error);
      result.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    }
  }
  if (!completed) return failed(result.lastError);
  result.siblings.sort((a, b) => b.confidence - a.confidence);
  result.status = result.siblings.length ? 'MATCHED' : 'NO_MATCH';
  return result;
}
