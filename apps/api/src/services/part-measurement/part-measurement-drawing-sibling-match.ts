import sharp from 'sharp';
import { z } from 'zod';

export const SIBLING_MATCH_VERSION = 'sibling-shape-v1';
export const SIBLING_SHAPE_THRESHOLD = 0.8;
export const siblingMatchesSchema = z.array(z.object({
  visualTemplateId: z.string(), confidence: z.number().finite().min(0).max(1)
}));
export type DrawingSibling = z.infer<typeof siblingMatchesSchema>[number];

type Drawing = { id: string; drawingImageRelativePath: string };
type PrefilterDeps = { readDrawing: (path: string) => Promise<{ buffer: Buffer }>; candidateLimit: () => number };

async function drawingShape(path: string, deps: PrefilterDeps) {
  const { data, info } = await sharp((await deps.readDrawing(path)).buffer)
    .flatten({ background: 'white' }).greyscale().trim({ background: 'white', threshold: 20 })
    .raw().toBuffer({ resolveWithObject: true });
  const vector = await sharp(data, { raw: info }).resize(32, 32, { fit: 'fill' }).raw().toBuffer();
  return { aspect: info.width / info.height, vector };
}

export async function prefilterDrawingSiblings<T extends Drawing>(target: Drawing, candidates: T[], deps: PrefilterDeps): Promise<T[]> {
  if (!candidates.length) return [];
  const shape = await drawingShape(target.drawingImageRelativePath, deps);
  // Decode one full-size drawing at a time to keep memory flat on the Pi.
  const ranked: Array<{ candidate: T; distance: number }> = [];
  for (const candidate of candidates.filter((other) => other.id !== target.id)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const other = await drawingShape(candidate.drawingImageRelativePath, deps);
      const densityDistance = shape.vector.reduce((sum, value, index) => sum + Math.abs(value - other.vector[index]) / 255, 0) / shape.vector.length;
      ranked.push({ candidate, distance: Math.abs(Math.log(shape.aspect / other.aspect)) + densityDistance });
    } catch { /* An unreadable drawing is simply not a candidate. */ }
  }
  return ranked.sort((a, b) => a.distance - b.distance || a.candidate.id.localeCompare(b.candidate.id))
    .slice(0, deps.candidateLimit()).map(({ candidate }) => candidate);
}

const visionResponseSchema = z.object({ shapeSimilarity: z.number().finite().min(0).max(1) });
export function parseSiblingVisionResponse(rawText: string) {
  const text = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return visionResponseSchema.parse(JSON.parse(text));
}

export const SIBLING_VISION_INSTRUCTIONS = `2枚の機械図面 target と candidate_1 を比べ、部品の「形」がどれだけ似ているかを判定する。目的は、candidate_1 の検査箇所をそのまま target に写せるかの判断。
図面名、品番、表題欄、注記、材質、会社名は見ない。名前が同じでも形が違えば似ていない。名前が違っても形が同じなら似ている。寸法の数値の違いは気にしない（大きさ違いは似ているとみなす）。
次を順に比べる: outline=外形の種類と縦横比（板、ブロック、L字、T字、円筒、枠など）、views=投影図の数と並び方、holes=穴・ねじ穴の数と並び方、features=段差・溝・ザグリ・切欠きなど主な形状。
目安: 0.9以上=同じ形で大きさや穴数だけ違う（左右対称の対も含む）、0.6〜0.8=同じ型だが主な形状が一部違う、0.3〜0.5=同じ種類の部品だが形は別物、0.2以下=まったく別。
JSON のみで返す: {"outline":"同/違 と一言","views":"同/違 と一言","holes":"同/違 と一言","features":"同/違 と一言","shapeSimilarity":0.0}
考えた過程は書かず、最初の文字から JSON を書く。`;
