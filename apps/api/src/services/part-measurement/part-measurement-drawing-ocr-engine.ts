import sharp from 'sharp';

import type { ImageOcrLayoutPort } from '../ocr/ports/image-ocr-layout.port.js';
import type {
  PartMeasurementDrawingOcrPayload,
  PartMeasurementDrawingOcrToken
} from './part-measurement-drawing-ocr-payload.js';
import {
  PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_OCR_VERSION
} from './part-measurement-drawing-ocr-payload.js';

type OcrPass = {
  id: string;
  kind: 'full' | 'tile';
  rect: PixelRect;
  rotation: 0 | 90 | 180 | 270;
};

type PixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const FULL_ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 180];
const TILE_ROTATIONS: Array<0 | 90 | 180 | 270> = [0];
const TILE_GRID = 3;
const TILE_OVERLAP_RATIO = 0.16;
const MAX_LONG_EDGE = 2400;
const MAX_TOKENS = 2500;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizedRotation(rotation: number): 0 | 90 | 180 | 270 {
  const n = ((rotation % 360) + 360) % 360;
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

function buildTileRect(
  col: number,
  row: number,
  imageWidth: number,
  imageHeight: number
): PixelRect {
  const baseWidth = imageWidth / TILE_GRID;
  const baseHeight = imageHeight / TILE_GRID;
  const overlapX = baseWidth * TILE_OVERLAP_RATIO;
  const overlapY = baseHeight * TILE_OVERLAP_RATIO;
  const left = Math.max(0, Math.floor(col * baseWidth - overlapX));
  const top = Math.max(0, Math.floor(row * baseHeight - overlapY));
  const right = Math.min(imageWidth, Math.ceil((col + 1) * baseWidth + overlapX));
  const bottom = Math.min(imageHeight, Math.ceil((row + 1) * baseHeight + overlapY));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function buildOcrPasses(imageWidth: number, imageHeight: number): OcrPass[] {
  const passes: OcrPass[] = FULL_ROTATIONS.map((rotation) => ({
    id: `full-r${rotation}`,
    kind: 'full',
    rect: { left: 0, top: 0, width: imageWidth, height: imageHeight },
    rotation
  }));

  for (let row = 0; row < TILE_GRID; row += 1) {
    for (let col = 0; col < TILE_GRID; col += 1) {
      for (const rotation of TILE_ROTATIONS) {
        passes.push({
          id: `tile-${col}-${row}-r${rotation}`,
          kind: 'tile',
          rect: buildTileRect(col, row, imageWidth, imageHeight),
          rotation
        });
      }
    }
  }
  return passes;
}

function rotatedUnscaledSize(rect: PixelRect, rotation: 0 | 90 | 180 | 270): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: rect.height, height: rect.width }
    : { width: rect.width, height: rect.height };
}

function rotatedPointToCropPoint(
  x: number,
  y: number,
  rect: PixelRect,
  rotation: 0 | 90 | 180 | 270
): { x: number; y: number } {
  switch (normalizedRotation(rotation)) {
    case 90:
      return { x: y, y: rect.height - x };
    case 180:
      return { x: rect.width - x, y: rect.height - y };
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
  pass: OcrPass;
  imageWidth: number;
  imageHeight: number;
}): { xRatio: number; yRatio: number; widthRatio: number; heightRatio: number } {
  const rotatedSize = rotatedUnscaledSize(input.pass.rect, input.pass.rotation);
  const scaleX = rotatedSize.width / Math.max(1, input.ocrWidth);
  const scaleY = rotatedSize.height / Math.max(1, input.ocrHeight);
  const corners = [
    { x: input.bbox.x0 * scaleX, y: input.bbox.y0 * scaleY },
    { x: input.bbox.x1 * scaleX, y: input.bbox.y0 * scaleY },
    { x: input.bbox.x1 * scaleX, y: input.bbox.y1 * scaleY },
    { x: input.bbox.x0 * scaleX, y: input.bbox.y1 * scaleY }
  ].map((point) => {
    const crop = rotatedPointToCropPoint(point.x, point.y, input.pass.rect, input.pass.rotation);
    return {
      x: input.pass.rect.left + crop.x,
      y: input.pass.rect.top + crop.y
    };
  });

  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    xRatio: clamp01(centerX / input.imageWidth),
    yRatio: clamp01(centerY / input.imageHeight),
    widthRatio: clamp01(Math.max(0, maxX - minX) / input.imageWidth),
    heightRatio: clamp01(Math.max(0, maxY - minY) / input.imageHeight)
  };
}

async function renderPassImage(buffer: Buffer, pass: OcrPass): Promise<{ buffer: Buffer; width: number; height: number }> {
  const rendered = await sharp(buffer, { failOn: 'none' })
    .extract(pass.rect)
    .rotate(pass.rotation)
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

export class PartMeasurementDrawingOcrEngine {
  constructor(private readonly layoutOcr: ImageOcrLayoutPort) {}

  async run(buffer: Buffer): Promise<PartMeasurementDrawingOcrPayload> {
    const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new Error('Invalid drawing image dimensions');
    }

    const tokens: PartMeasurementDrawingOcrToken[] = [];
    let engine = 'unknown';
    for (const pass of buildOcrPasses(width, height)) {
      if (tokens.length >= MAX_TOKENS) break;
      // eslint-disable-next-line no-await-in-loop
      const passImage = await renderPassImage(buffer, pass);
      // eslint-disable-next-line no-await-in-loop
      const ocr = await this.layoutOcr.runLayoutOcrOnImage({
        imageBytes: passImage.buffer,
        mimeType: 'image/jpeg',
        profile: 'partMeasurementDrawingDimensions'
      });
      engine = ocr.engine;
      for (const word of ocr.words) {
        if (!/\d/.test(word.text)) continue;
        const ratios = mapBboxToOriginalRatios({
          bbox: word.bbox,
          ocrWidth: passImage.width,
          ocrHeight: passImage.height,
          pass,
          imageWidth: width,
          imageHeight: height
        });
        tokens.push({
          text: word.text,
          confidence: word.confidence,
          ...ratios,
          passId: pass.id,
          passKind: pass.kind,
          rotation: pass.rotation
        });
        if (tokens.length >= MAX_TOKENS) break;
      }
    }

    return {
      schemaVersion: PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
      ocrVersion: PART_MEASUREMENT_DRAWING_OCR_VERSION,
      engine,
      createdAt: new Date().toISOString(),
      image: { width, height },
      tokens
    };
  }
}
