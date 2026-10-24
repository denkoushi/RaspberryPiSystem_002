import { z } from 'zod/v3';

import { drawingNameFamily, type DimensionMap } from './part-measurement-drawing-placement-transfer.js';

export const SIBLING_MATCH_VERSION = 'sibling-v1';
export const siblingMatchesSchema = z.array(z.object({
  visualTemplateId: z.string(), confidence: z.number().finite().min(0).max(1)
}));
export type DrawingSibling = z.infer<typeof siblingMatchesSchema>[number];

type Candidate = { id: string; name: string; map: DimensionMap };
export function prefilterDrawingSiblings<T extends Candidate>(target: Candidate, candidates: T[]): Array<T & { score: number }> {
  const pairs = target.map.dimensions.filter((dimension, index, all) => dimension.kind !== 'other' &&
    all.findIndex((other) => other.kind === dimension.kind && Math.abs(other.nominal - dimension.nominal) <= 1e-6) === index);
  const family = drawingNameFamily(target.name);
  return candidates.filter((candidate) => candidate.id !== target.id).map((candidate) => ({
    ...candidate,
    score: pairs.filter((pair) => candidate.map.dimensions.some((other) =>
      other.kind === pair.kind && Math.abs(other.nominal - pair.nominal) <= 1e-6)).length +
      (family && drawingNameFamily(candidate.name) === family ? 3 : 0)
  })).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 8);
}

const visionResponseSchema = z.object({
  candidates: z.array(z.object({
    label: z.string(), sameFamily: z.boolean(), confidence: z.number().finite().min(0).max(1)
  }))
});
export function parseSiblingVisionResponse(rawText: string, labels: string[]) {
  const text = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const result = visionResponseSchema.parse(JSON.parse(text));
  const seen = new Set(result.candidates.map((candidate) => candidate.label));
  if (seen.size !== result.candidates.length || seen.size !== labels.length || labels.some((label) => !seen.has(label))) {
    throw new Error('Invalid sibling candidate labels');
  }
  return result.candidates;
}

export const SIBLING_VISION_INSTRUCTIONS = 'target は検査対象の機械部品の図面、candidate_1 以降は比較候補の図面です。同じ種類の部品で、全体形状と投影図の配置が似ていて寸法位置が対応するものを同じ部品系列と判断してください。サイズや長さが違う派生品は同じ系列です。数値が共通するだけの別部品は同じ系列ではありません。';
