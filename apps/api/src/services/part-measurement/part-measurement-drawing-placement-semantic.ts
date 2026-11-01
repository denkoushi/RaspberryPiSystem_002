import sharp from 'sharp';
import { z } from 'zod';

import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { candidateValue, resolveWantedDimensionKind, suggestTolerances } from './part-measurement-drawing-dimension-map-candidates.js';
import { semanticPlacementRejections } from './part-measurement-drawing-placement-semantic-checks.js';
import {
  placementItemAlreadyExists,
  sourceItemDimension,
  type DimensionMap,
  type PlacementExistingItem,
  type PlacementSourceItem,
  type PlacementTransferResult
} from './part-measurement-drawing-placement-transfer.js';

export const drawingPlacementSemanticDeps = {
  vision: () => getInferenceRuntime().createMultiImageVisionCompletionPort(),
  readDrawing: (path: string) => PartMeasurementDrawingStorage.readDrawing(path)
};

const H7_TOLERANCES = [
  [3, 0.010], [6, 0.012], [10, 0.015], [18, 0.018], [30, 0.021], [50, 0.025], [80, 0.030],
  [120, 0.035], [180, 0.040], [250, 0.046], [315, 0.052], [400, 0.057], [500, 0.063]
];

const INSTRUCTIONS = `1枚目は写し元の図面です。青い丸の番号は人が付けた検査項目の丸数字です。
2枚目は写し先の図面です。赤い D 番号は読み取れた寸法です。
各丸数字が部品のどこの何を測っているか（例「上面図 全幅」）を考え、写し先で同じ箇所を測る D 番号を選んでください。
数値の一致では選ばないでください。置けないときは target を null にしてください。
全丸数字について1件ずつ出力してください。role は15字以内です。
考えた過程は書かず、最初の文字から JSON を出してください。出力は JSON だけです。
形式: {"items":[{"n":1,"role":"上面図 全幅","target":"D3"}]}`;

export function unplacedSemanticItems(sourceItems: PlacementSourceItem[]): PlacementTransferResult[] {
  return sourceItems.map((item) => ({
    item, nominalValue: item.nominalValue, lowerLimit: item.lowerLimit, upperLimit: item.upperLimit,
    status: 'UNPLACED', dimension: null, markerXRatio: null, markerYRatio: null, candidates: []
  }));
}

async function annotatedImage(
  bytes: Buffer, points: { xRatio: number; yRatio: number }[], source: boolean
): Promise<Buffer> {
  const { data, info } = await sharp(bytes).flatten({ background: 'white' })
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const color = source ? '#0066ff' : '#ee0000';
  const marks = points.map((point, i) => {
    const x = point.xRatio * info.width;
    const y = point.yRatio * info.height;
    return source
      ? `<circle cx="${x}" cy="${y}" r="15" fill="white" stroke="${color}" stroke-width="2"/><text x="${x}" y="${y + 6}" text-anchor="middle">${i + 1}</text>`
      : `<text x="${x}" y="${y}" text-anchor="middle" stroke="white" stroke-width="3" paint-order="stroke">D${i + 1}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}"><g fill="${color}" font-family="sans-serif" font-size="18" font-weight="bold">${marks}</g></svg>`;
  return sharp(data).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 85 }).toBuffer();
}

// DGX caps a call at 120s; stay just under it.
export const SEMANTIC_PLACEMENT_TIMEOUT_MS = 115_000;

export async function transferItemsSemantically(input: {
  sourceDrawingPath: string;
  targetDrawingPath: string;
  sourceItems: PlacementSourceItem[];
  sourceMap: DimensionMap | null;
  targetMap: DimensionMap;
  existingItems: PlacementExistingItem[];
}, deps = drawingPlacementSemanticDeps): Promise<PlacementTransferResult[]> {
  const source = await deps.readDrawing(input.sourceDrawingPath);
  const sourceImage = await annotatedImage(source.buffer, input.sourceItems.map((item) => ({
    xRatio: item.markerXRatio, yRatio: item.markerYRatio
  })), true);
  const target = await deps.readDrawing(input.targetDrawingPath);
  const targetImage = await annotatedImage(target.buffer, input.targetMap.dimensions, false);
  const { rawText } = await deps.vision().completeMany({
    images: [
      { label: 'source', mimeType: 'image/jpeg', imageBytes: sourceImage },
      { label: 'target', mimeType: 'image/jpeg', imageBytes: targetImage }
    ],
    background: true, jsonOutput: true, timeoutMs: SEMANTIC_PLACEMENT_TIMEOUT_MS, temperature: 0, maxTokens: 6000,
    userText: `${INSTRUCTIONS}\n丸数字一覧:\n${JSON.stringify(input.sourceItems.map((item, i) => ({
      n: i + 1, measurementLabel: item.measurementLabel, nominalValue: item.nominalValue,
      lowerLimit: item.lowerLimit, upperLimit: item.upperLimit
    })))}\nD 番号一覧:\n${JSON.stringify(input.targetMap.dimensions.map((dimension, i) => ({
      target: `D${i + 1}`, text: dimension.text, kind: dimension.kind
    })))}`
  });
  // GLM sometimes drops items or overruns the role length; keep what it answered instead of failing the run.
  const text = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const response = z.object({ items: z.array(z.unknown()) }).parse(JSON.parse(text));
  const entrySchema = z.object({
    n: z.number().int().min(1).max(input.sourceItems.length),
    role: z.string().transform((role) => role.slice(0, 15)).catch(''),
    target: z.string().regex(/^D[1-9]\d*$/)
      .refine((target) => Number(target.slice(1)) <= input.targetMap.dimensions.length).nullable().catch(null)
  });
  const byNumber = new Map<number, z.infer<typeof entrySchema>>();
  for (const raw of response.items) {
    const entry = entrySchema.safeParse(raw);
    if (!entry.success || byNumber.has(entry.data.n)) continue;
    byNumber.set(entry.data.n, entry.data);
  }
  const assignments = input.sourceItems.map((item, i) => {
    const entry = byNumber.get(i + 1) ?? { n: i + 1, role: '', target: null };
    return {
      measurementLabel: item.measurementLabel, depthMode: item.depthMode, valueKind: item.valueKind, ...entry,
      dimension: entry.target ? input.targetMap.dimensions[Number(entry.target.slice(1)) - 1] : null
    };
  });
  const rejections = semanticPlacementRejections(assignments);
  return unplacedSemanticItems(input.sourceItems).flatMap((result, i) => {
    const { item } = result;
    const { dimension, target, role } = assignments[i];
    if (!dimension || !target) return [result];
    const { text, xRatio, yRatio, kind } = dimension;
    const wanted = resolveWantedDimensionKind(item.measurementLabel, item.depthMode === 'THROUGH' ? 'through' : 'measured');
    // A depth drawn as its own linear dimension (e.g. a counterbore depth) has no depth field; read its length instead.
    const value = item.valueKind === 'JUDGEMENT' ? item.nominalValue
      : wanted === 'depth' && dimension.depth === null && kind === 'len' ? candidateValue(dimension, 'len')
      : candidateValue(dimension, wanted);
    const rejectionReason = rejections[i] ?? (value === null || (item.valueKind !== 'JUDGEMENT' && value <= 0) ? 'unreadable-value' : null);
    result.candidates = [{ text, xRatio, yRatio, kind, distance: 0, role, target,
      ...(rejectionReason ? { rejectionReason } : {}) }];
    if (rejectionReason || value === null) return [result];
    result.nominalValue = value;
    if (item.valueKind !== 'JUDGEMENT') {
      const round = (limit: number) => Number(limit.toFixed(6));
      if (kind === 'gdt' || wanted === 'gdt') {
        result.lowerLimit = 0;
        result.upperLimit = value;
      } else if (wanted === 'depth') {
        if (dimension.depth === null && kind === 'len' && dimension.lowerTolerance !== null && dimension.upperTolerance !== null) {
          result.lowerLimit = round(value + dimension.lowerTolerance);
          result.upperLimit = round(value + dimension.upperTolerance);
        } else {
          result.lowerLimit = value;
          result.upperLimit = item.upperLimit === null ? null : round(value + (item.upperLimit - item.nominalValue));
        }
      } else {
        const fit = dimension.upperTolerance === null && dimension.lowerTolerance === null
          ? text.normalize('NFKC').trim().match(/\d+(?:\.\d+)?\s*([A-Za-z](?:\d+|$))(?=$|[^A-Za-z0-9])/u)?.[1] : null;
        const it7 = fit === 'H7' ? H7_TOLERANCES.find(([max]) => value <= max)?.[1] : null;
        const tolerance = fit
          ? { lower: it7 == null ? null : '0', upper: it7 == null ? null : String(it7) }
          : suggestTolerances(dimension, wanted, value);
        if (tolerance.lower === null && tolerance.upper === null) {
          result.lowerLimit = item.lowerLimit === null ? null : round(value - (item.nominalValue - item.lowerLimit));
          result.upperLimit = item.upperLimit === null ? null : round(value + (item.upperLimit - item.nominalValue));
        } else {
          result.lowerLimit = tolerance.lower === null ? null : round(value + Number(tolerance.lower));
          result.upperLimit = tolerance.upper === null ? null : round(value + Number(tolerance.upper));
        }
      }
    }
    if (placementItemAlreadyExists({ measurementLabel: item.measurementLabel, nominalValue: value }, input.existingItems)) return [];
    const own = sourceItemDimension(input.sourceMap, item);
    let offsetX = own ? item.markerXRatio - own.xRatio : 0.02;
    let offsetY = own ? item.markerYRatio - own.yRatio : -0.02;
    const offsetLength = Math.hypot(offsetX, offsetY);
    if (own && offsetLength > 0.03) {
      offsetX *= 0.03 / offsetLength;
      offsetY *= 0.03 / offsetLength;
    }
    return [{
      ...result, status: 'PROPOSED', dimension: { text, xRatio, yRatio, kind },
      markerXRatio: Math.min(0.99, Math.max(0.01, xRatio + offsetX)),
      markerYRatio: Math.min(0.99, Math.max(0.01, yRatio + offsetY))
    }];
  });
}
