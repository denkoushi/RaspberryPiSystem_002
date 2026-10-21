import sharp from 'sharp';

import { env } from '../../config/env.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';
import { prisma } from '../../lib/prisma.js';
import { requestJevChoice, type JevImageAsset } from '../typesafe/jev-choice-client.js';
import { sourceItemDimension } from './part-measurement-drawing-placement-transfer.js';
import type { PlacementReorderProvider } from './part-measurement-drawing-placement.service.js';

export const TRANSFER_JEV_INSTRUCTIONS = "これは機械部品の図面の比較である。`source_detail` は、ある部品の図面(元の図面)の一部を拡大した画像で、赤い丸で囲んだ寸法に検査項目 `item` が付いている(青い点は検査項目の番号札の位置)。元の図面とよく似た別の部品の図面(新しい図面)から、同じ基準値の寸法を候補として切り出した。各候補の画像では、候補の寸法を赤い丸で囲んである。\n新しい図面の候補のうち、元の図面の赤丸の寸法と「部品の同じ箇所・同じ形状を測る寸法」を一つ選ぶ。数値が同じなのは全候補に共通なので、数値ではなく、周りの形状(どの穴・どの面・どの段か)、寸法線の向き、近くの他の寸法や注記、ねじの本数の表記などの並び方で判断する。該当がなければ none を選ぶ。";

/** Python's default %g: six significant digits, fixed notation for exponents -4 through 5. */
export function formatTransferNominal(value: number): string {
  if (Object.is(value, -0)) return '-0';
  const [mantissa, exponentText] = value.toExponential(5).split('e');
  const exponent = Number(exponentText);
  const trim = (text: string) => text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  if (exponent >= -4 && exponent < 6) return trim(Number(value.toPrecision(6)).toFixed(Math.max(0, 5 - exponent)));
  return `${trim(mantissa)}e${exponent < 0 ? '-' : '+'}${Math.abs(exponent).toString().padStart(2, '0')}`;
}

export async function cropTransferDrawing(
  image: Buffer, point: { xRatio: number; yRatio: number }, marker?: { xRatio: number; yRatio: number }
): Promise<Buffer> {
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error('Missing drawing dimensions');
  const side = Math.max(Math.trunc(width * 0.15), 64);
  const left = Math.trunc(point.xRatio * width - side / 2);
  const top = Math.trunc(point.yRatio * height - side / 2);
  const x = Math.max(left, 0);
  const y = Math.max(top, 0);
  const cropWidth = Math.min(left + side, width) - x;
  const cropHeight = Math.min(top + side, height) - y;
  if (cropWidth <= 0 || cropHeight <= 0) throw new Error('Crop is outside drawing');
  const padded = await sharp(image).flatten({ background: 'white' })
    .extract({ left: x, top: y, width: cropWidth, height: cropHeight })
    .extend({ left: x - left, top: y - top, right: side - cropWidth - (x - left), bottom: side - cropHeight - (y - top), background: 'white' })
    .png().toBuffer();
  // Sharp applies extend after resize in one pipeline; materialize padding before resizing.
  const crop = await sharp(padded).resize(640, 640, { kernel: 'lanczos3' }).toBuffer();
  const dot = marker ? `<circle cx="${(marker.xRatio * width - left) / side * 640}" cy="${(marker.yRatio * height - top) / side * 640}" r="14" fill="rgb(0,90,230)"/>` : '';
  const overlay = Buffer.from(`<svg width="640" height="640"><circle cx="320" cy="320" r="${640 * 0.13}" fill="none" stroke="rgb(230,0,0)" stroke-width="3"/>${dot}</svg>`);
  return sharp(crop).composite([{ input: overlay }]).jpeg({ quality: 90 }).toBuffer();
}

async function readDrawing(visualTemplateId: string): Promise<Buffer> {
  const visual = await prisma.partMeasurementVisualTemplate.findUnique({
    where: { id: visualTemplateId }, select: { drawingImageRelativePath: true }
  });
  if (!visual) throw new Error('Visual template not found');
  return (await PartMeasurementDrawingStorage.readDrawing(visual.drawingImageRelativePath)).buffer;
}

type Deps = {
  enabled: boolean;
  apiKey?: string;
  timeoutMs: number;
  readDrawing: (visualTemplateId: string) => Promise<Buffer>;
  fetch?: typeof fetch;
};

/** Create once per nightly run: all drawings share the call budget and concurrency limit. */
export function createPlacementJevReorderProvider(deps: Deps = {
  enabled: env.INSPECTION_DRAWING_TRANSFER_JEV_ENABLED,
  apiKey: env.TYPESAFE_API_KEY,
  timeoutMs: env.INSPECTION_DRAWING_TRANSFER_JEV_TIMEOUT_MS,
  readDrawing
}): PlacementReorderProvider | null {
  const apiKey = deps.apiKey;
  if (!deps.enabled || !apiKey?.trim()) return null;
  let calls = 0;
  let active = 0;
  const waiting: Array<() => void> = [];
  return (targetId, { sourceVisualTemplateId, sourceMap }) => {
    let images: Promise<[Buffer, Buffer]> | undefined;
    return async (item, candidates) => {
      if (candidates.length < 2 || calls >= 40) return candidates;
      calls++;
      if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
      else active++;
      try {
        images ??= Promise.all([deps.readDrawing(sourceVisualTemplateId), deps.readDrawing(targetId)]);
        const [source, target] = await images;
        const marker = { xRatio: item.markerXRatio, yRatio: item.markerYRatio };
        const sourcePoint = sourceItemDimension(sourceMap, item) ?? marker;
        const selected = candidates.slice(0, 8);
        const crops = await Promise.all([
          cropTransferDrawing(source, sourcePoint, marker),
          ...selected.map((candidate) => cropTransferDrawing(target, candidate))
        ]);
        const assets: Record<string, JevImageAsset> = {};
        crops.forEach((crop, index) => {
          assets[`image-${index}`] = { type: 'image', format: 'jpeg', data_base64: crop.toString('base64') };
        });
        const criteria: Record<string, string> = {};
        selected.forEach((_, index) => { criteria[`c${index + 1}`] = `新しい図面の候補${index + 1}: image-${index + 1}`; });
        criteria.none = 'どの候補も、元の図面の赤丸の寸法と同じ箇所の寸法ではない';
        const probabilities = await requestJevChoice({
          apiKey, timeoutMs: deps.timeoutMs, fetch: deps.fetch,
          state: { item: `項目名「${item.measurementLabel}」 基準値 ${formatTransferNominal(item.nominalValue)}`, source_detail: 'image-0' },
          instructions: TRANSFER_JEV_INSTRUCTIONS, criteria, assets
        });
        const ranked = selected.map((candidate, index) => ({ ...candidate, score: probabilities[`c${index + 1}`] }))
          .sort((a, b) => b.score - a.score);
        return [...ranked, ...candidates.slice(8)];
      } catch {
        return candidates;
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    };
  };
}
