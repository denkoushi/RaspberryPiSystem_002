import sharp from 'sharp';

import type { ImageOcrLayoutPort } from '../ocr/ports/image-ocr-layout.port.js';
import type { DrawingLocalOcrPort, DrawingLocalOcrRequest } from './drawing-local-ocr.port.js';
import type { PartMeasurementDrawingOcrToken } from './part-measurement-drawing-ocr-payload.js';

type PixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const LOCAL_ROTATIONS: Array<0 | 90 | 270> = [0, 90, 270];
const MAX_LONG_EDGE = 900;
const DEFAULT_HALF_RATIO = 0.055;
const DEPTH_HALF_RATIO = 0.11;
const DEPTH_ANNULUS_INNER = 0.06;
const DEPTH_ANNULUS_OUTER = 0.14;
const LOCAL_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.PART_MEASUREMENT_DRAWING_OCR_LOCAL_TIMEOUT_MS || '8000', 10) || 8000
);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function buildCenteredRect(
  xRatio: number,
  yRatio: number,
  halfRatio: number,
  imageWidth: number,
  imageHeight: number
): PixelRect {
  const cx = clamp01(xRatio) * imageWidth;
  const cy = clamp01(yRatio) * imageHeight;
  const halfW = Math.max(24, Math.floor(imageWidth * halfRatio));
  const halfH = Math.max(24, Math.floor(imageHeight * halfRatio));
  const left = Math.max(0, Math.floor(cx - halfW));
  const top = Math.max(0, Math.floor(cy - halfH));
  const right = Math.min(imageWidth, Math.ceil(cx + halfW));
  const bottom = Math.min(imageHeight, Math.ceil(cy + halfH));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function buildAnnulusRects(
  xRatio: number,
  yRatio: number,
  imageWidth: number,
  imageHeight: number
): PixelRect[] {
  const cx = clamp01(xRatio) * imageWidth;
  const cy = clamp01(yRatio) * imageHeight;
  const inner = Math.max(32, Math.floor(Math.min(imageWidth, imageHeight) * DEPTH_ANNULUS_INNER));
  const outer = Math.max(inner + 16, Math.floor(Math.min(imageWidth, imageHeight) * DEPTH_ANNULUS_OUTER));
  const band = Math.max(28, outer - inner);
  const candidates: Array<{ left: number; top: number; width: number; height: number }> = [
    { left: cx - outer, top: cy - outer, width: outer * 2, height: band },
    { left: cx - outer, top: cy + inner, width: outer * 2, height: band },
    { left: cx - outer, top: cy - outer, width: band, height: outer * 2 },
    { left: cx + inner, top: cy - outer, width: band, height: outer * 2 }
  ];
  return candidates
    .map((rect) => {
      const left = Math.max(0, Math.floor(rect.left));
      const top = Math.max(0, Math.floor(rect.top));
      const right = Math.min(imageWidth, Math.ceil(rect.left + rect.width));
      const bottom = Math.min(imageHeight, Math.ceil(rect.top + rect.height));
      return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
      };
    })
    .filter((rect) => rect.width >= 20 && rect.height >= 20);
}

function rotatedUnscaledSize(rect: PixelRect, rotation: 0 | 90 | 270): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: rect.height, height: rect.width }
    : { width: rect.width, height: rect.height };
}

function rotatedPointToCropPoint(
  x: number,
  y: number,
  rect: PixelRect,
  rotation: 0 | 90 | 270
): { x: number; y: number } {
  switch (rotation) {
    case 90:
      return { x: y, y: rect.height - x };
    case 270:
      return { x: rect.width - y, y: x };
    case 0:
    default:
      return { x, y };
  }
}

function mapBboxToOriginalRatios(input: {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  ocrWidth: number;
  ocrHeight: number;
  rect: PixelRect;
  rotation: 0 | 90 | 270;
  imageWidth: number;
  imageHeight: number;
}): { xRatio: number; yRatio: number; widthRatio: number; heightRatio: number } {
  const rotatedSize = rotatedUnscaledSize(input.rect, input.rotation);
  const scaleX = rotatedSize.width / Math.max(1, input.ocrWidth);
  const scaleY = rotatedSize.height / Math.max(1, input.ocrHeight);
  const corners = [
    { x: input.bbox.x0 * scaleX, y: input.bbox.y0 * scaleY },
    { x: input.bbox.x1 * scaleX, y: input.bbox.y0 * scaleY },
    { x: input.bbox.x1 * scaleX, y: input.bbox.y1 * scaleY },
    { x: input.bbox.x0 * scaleX, y: input.bbox.y1 * scaleY }
  ].map((point) => {
    const crop = rotatedPointToCropPoint(point.x, point.y, input.rect, input.rotation);
    return {
      x: input.rect.left + crop.x,
      y: input.rect.top + crop.y
    };
  });
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  return {
    xRatio: clamp01((minX + maxX) / 2 / input.imageWidth),
    yRatio: clamp01((minY + maxY) / 2 / input.imageHeight),
    widthRatio: clamp01(Math.max(0, maxX - minX) / input.imageWidth),
    heightRatio: clamp01(Math.max(0, maxY - minY) / input.imageHeight)
  };
}

async function renderLocalPass(
  buffer: Buffer,
  rect: PixelRect,
  rotation: 0 | 90 | 270
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const crop = sharp(buffer, { failOn: 'none' }).extract(rect);
  const source =
    rotation === 90 || rotation === 270
      ? sharp(await crop.toBuffer(), { failOn: 'none' }).rotate(rotation)
      : crop;
  const rendered = await source
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: false
    })
    .greyscale()
    .normalize()
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: rendered.data,
    width: rendered.info.width,
    height: rendered.info.height
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('local OCR timed out')), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class DrawingLocalOcrTesseractAdapter implements DrawingLocalOcrPort {
  constructor(private readonly layoutOcr: ImageOcrLayoutPort) {}

  async runLocalOcr(input: DrawingLocalOcrRequest): Promise<PartMeasurementDrawingOcrToken[]> {
    return withTimeout(this.runLocalOcrInner(input), LOCAL_TIMEOUT_MS);
  }

  private async runLocalOcrInner(input: DrawingLocalOcrRequest): Promise<PartMeasurementDrawingOcrToken[]> {
    const metadata = await sharp(input.imageBytes, { failOn: 'none' }).metadata();
    const imageWidth = metadata.width ?? 0;
    const imageHeight = metadata.height ?? 0;
    if (imageWidth <= 0 || imageHeight <= 0) {
      throw new Error('Invalid drawing image dimensions for local OCR');
    }

    const halfRatio = input.depthSearch ? DEPTH_HALF_RATIO : DEFAULT_HALF_RATIO;
    const rects: PixelRect[] = [
      buildCenteredRect(input.xRatio, input.yRatio, halfRatio, imageWidth, imageHeight)
    ];
    if (input.depthSearch) {
      rects.push(...buildAnnulusRects(input.xRatio, input.yRatio, imageWidth, imageHeight).slice(0, 2));
    }

    const tokens: PartMeasurementDrawingOcrToken[] = [];
    let passIndex = 0;
    for (const rect of rects) {
      for (const rotation of LOCAL_ROTATIONS) {
        // eslint-disable-next-line no-await-in-loop
        const passImage = await renderLocalPass(input.imageBytes, rect, rotation);
        // eslint-disable-next-line no-await-in-loop
        const ocr = await this.layoutOcr.runLayoutOcrOnImage({
          imageBytes: passImage.buffer,
          mimeType: 'image/jpeg',
          profile: 'partMeasurementDrawingDimensions'
        });
        for (const word of ocr.words) {
          if (!/\d/.test(word.text)) continue;
          const ratios = mapBboxToOriginalRatios({
            bbox: word.bbox,
            ocrWidth: passImage.width,
            ocrHeight: passImage.height,
            rect,
            rotation,
            imageWidth,
            imageHeight
          });
          tokens.push({
            text: word.text,
            confidence: word.confidence,
            ...ratios,
            passId: `local-${passIndex}-r${rotation}`,
            passKind: 'tile',
            preprocessKind: 'raw',
            rotation
          });
        }
        passIndex += 1;
      }
    }
    return tokens;
  }
}

export function isDrawingLocalOcrEnabled(): boolean {
  const raw = process.env.PART_MEASUREMENT_DRAWING_OCR_LOCAL_ENABLED;
  if (raw == null || raw.trim() === '') return true;
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}
