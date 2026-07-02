import sharp from 'sharp';

import type { ImageOcrLayoutPort } from '../ocr/ports/image-ocr-layout.port.js';
import type {
  PartMeasurementDrawingOcrPayload,
  PartMeasurementDrawingOcrPassKind,
  PartMeasurementDrawingOcrPreprocessKind,
  PartMeasurementDrawingOcrToken
} from './part-measurement-drawing-ocr-payload.js';
import {
  PART_MEASUREMENT_DRAWING_OCR_PAYLOAD_SCHEMA_VERSION,
  PART_MEASUREMENT_DRAWING_OCR_VERSION
} from './part-measurement-drawing-ocr-payload.js';

type OcrPass = {
  id: string;
  kind: PartMeasurementDrawingOcrPassKind;
  preprocessKind: PartMeasurementDrawingOcrPreprocessKind;
  rect: PixelRect;
  rotation: 0 | 90 | 180 | 270;
};

type PixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const FULL_ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
const TILE_ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 270];
const TILE_GRID = 3;
const TILE_OVERLAP_RATIO = 0.16;
const MAX_LONG_EDGE = 2400;
const MAX_TOKENS = 4000;
const MAX_FRAME_PASSES = 24;
const DARK_PIXEL_THRESHOLD = 150;

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

function buildBaseOcrPasses(
  imageWidth: number,
  imageHeight: number,
  preprocessKind: PartMeasurementDrawingOcrPreprocessKind
): OcrPass[] {
  const prefix = preprocessKind === 'raw' ? 'raw' : 'line';
  const passes: OcrPass[] = FULL_ROTATIONS.map((rotation) => ({
    id: `${prefix}-full-r${rotation}`,
    kind: 'full',
    preprocessKind,
    rect: { left: 0, top: 0, width: imageWidth, height: imageHeight },
    rotation
  }));

  for (let row = 0; row < TILE_GRID; row += 1) {
    for (let col = 0; col < TILE_GRID; col += 1) {
      for (const rotation of TILE_ROTATIONS) {
        passes.push({
          id: `${prefix}-tile-${col}-${row}-r${rotation}`,
          kind: 'tile',
          preprocessKind,
          rect: buildTileRect(col, row, imageWidth, imageHeight),
          rotation
        });
      }
    }
  }
  return passes;
}

function buildFrameOcrPasses(rects: PixelRect[]): OcrPass[] {
  const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 270];
  return rects.flatMap((rect, index) =>
    rotations.map((rotation) => ({
      id: `frame-${index}-r${rotation}`,
      kind: 'frame' as const,
      preprocessKind: 'boxedFrame' as const,
      rect,
      rotation
    }))
  );
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

async function readNormalizedGrayscale(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const rendered = await sharp(buffer, { failOn: 'none' })
    .greyscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: Buffer.from(rendered.data),
    width: rendered.info.width,
    height: rendered.info.height
  };
}

function markPixel(mask: Uint8Array, width: number, height: number, x: number, y: number): void {
  for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
      mask[yy * width + xx] = 1;
    }
  }
}

function markLineRun(input: {
  mask: Uint8Array;
  width: number;
  height: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  length: number;
}): void {
  for (let i = 0; i < input.length; i += 1) {
    markPixel(
      input.mask,
      input.width,
      input.height,
      input.startX + input.dx * i,
      input.startY + input.dy * i
    );
  }
}

function markRunsInDirection(input: {
  data: Buffer;
  mask: Uint8Array;
  width: number;
  height: number;
  starts: Array<{ x: number; y: number }>;
  dx: number;
  dy: number;
  minRunLength: number;
}): void {
  for (const start of input.starts) {
    let x = start.x;
    let y = start.y;
    let runStartX = x;
    let runStartY = y;
    let runLength = 0;
    while (x >= 0 && x < input.width && y >= 0 && y < input.height) {
      const dark = input.data[y * input.width + x] < DARK_PIXEL_THRESHOLD;
      if (dark) {
        if (runLength === 0) {
          runStartX = x;
          runStartY = y;
        }
        runLength += 1;
      } else {
        if (runLength >= input.minRunLength) {
          markLineRun({
            mask: input.mask,
            width: input.width,
            height: input.height,
            startX: runStartX,
            startY: runStartY,
            dx: input.dx,
            dy: input.dy,
            length: runLength
          });
        }
        runLength = 0;
      }
      x += input.dx;
      y += input.dy;
    }
    if (runLength >= input.minRunLength) {
      markLineRun({
        mask: input.mask,
        width: input.width,
        height: input.height,
        startX: runStartX,
        startY: runStartY,
        dx: input.dx,
        dy: input.dy,
        length: runLength
      });
    }
  }
}

async function suppressLongDrawingLines(buffer: Buffer): Promise<Buffer> {
  const { data, width, height } = await readNormalizedGrayscale(buffer);
  const mask = new Uint8Array(width * height);
  const horizontalStarts = Array.from({ length: height }, (_, y) => ({ x: 0, y }));
  const verticalStarts = Array.from({ length: width }, (_, x) => ({ x, y: 0 }));
  const diagonalDownRightStarts = [
    ...Array.from({ length: width }, (_, x) => ({ x, y: 0 })),
    ...Array.from({ length: Math.max(0, height - 1) }, (_, y) => ({ x: 0, y: y + 1 }))
  ];
  const diagonalDownLeftStarts = [
    ...Array.from({ length: width }, (_, x) => ({ x, y: 0 })),
    ...Array.from({ length: Math.max(0, height - 1) }, (_, y) => ({ x: width - 1, y: y + 1 }))
  ];

  markRunsInDirection({
    data,
    mask,
    width,
    height,
    starts: horizontalStarts,
    dx: 1,
    dy: 0,
    minRunLength: Math.max(18, Math.floor(width * 0.018))
  });
  markRunsInDirection({
    data,
    mask,
    width,
    height,
    starts: verticalStarts,
    dx: 0,
    dy: 1,
    minRunLength: Math.max(18, Math.floor(height * 0.018))
  });
  const diagonalMinRun = Math.max(24, Math.floor(Math.min(width, height) * 0.02));
  markRunsInDirection({
    data,
    mask,
    width,
    height,
    starts: diagonalDownRightStarts,
    dx: 1,
    dy: 1,
    minRunLength: diagonalMinRun
  });
  markRunsInDirection({
    data,
    mask,
    width,
    height,
    starts: diagonalDownLeftStarts,
    dx: -1,
    dy: 1,
    minRunLength: diagonalMinRun
  });

  for (let i = 0; i < data.length; i += 1) {
    if (mask[i]) data[i] = 255;
  }

  return sharp(data, { raw: { width, height, channels: 1 }, failOn: 'none' })
    .jpeg({ quality: 92 })
    .toBuffer();
}

type LineSegment = {
  fixed: number;
  start: number;
  end: number;
};

function collectLineSegments(input: {
  data: Buffer;
  width: number;
  height: number;
  direction: 'horizontal' | 'vertical';
  minLength: number;
  maxLength: number;
}): LineSegment[] {
  const segments: LineSegment[] = [];
  const outer = input.direction === 'horizontal' ? input.height : input.width;
  const inner = input.direction === 'horizontal' ? input.width : input.height;
  for (let fixed = 0; fixed < outer; fixed += 1) {
    let runStart = 0;
    let runLength = 0;
    for (let moving = 0; moving < inner; moving += 1) {
      const x = input.direction === 'horizontal' ? moving : fixed;
      const y = input.direction === 'horizontal' ? fixed : moving;
      const dark = input.data[y * input.width + x] < DARK_PIXEL_THRESHOLD;
      if (dark) {
        if (runLength === 0) runStart = moving;
        runLength += 1;
      } else {
        if (runLength >= input.minLength && runLength <= input.maxLength) {
          segments.push({ fixed, start: runStart, end: moving - 1 });
        }
        runLength = 0;
      }
    }
    if (runLength >= input.minLength && runLength <= input.maxLength) {
      segments.push({ fixed, start: runStart, end: inner - 1 });
    }
  }
  return segments;
}

function overlaps(a: LineSegment, b: LineSegment, minOverlap: number): boolean {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) >= minOverlap;
}

function hasVerticalBorder(
  verticalSegments: LineSegment[],
  x: number,
  top: number,
  bottom: number,
  tolerance: number
): boolean {
  return verticalSegments.some(
    (segment) =>
      Math.abs(segment.fixed - x) <= tolerance &&
      segment.start <= top + tolerance &&
      segment.end >= bottom - tolerance
  );
}

function expandRect(rect: PixelRect, imageWidth: number, imageHeight: number, margin: number): PixelRect {
  const left = Math.max(0, rect.left - margin);
  const top = Math.max(0, rect.top - margin);
  const right = Math.min(imageWidth, rect.left + rect.width + margin);
  const bottom = Math.min(imageHeight, rect.top + rect.height + margin);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function dedupeRects(rects: PixelRect[]): PixelRect[] {
  const unique: PixelRect[] = [];
  for (const rect of rects.sort((a, b) => a.top - b.top || a.left - b.left || b.width * b.height - a.width * a.height)) {
    const duplicate = unique.some(
      (existing) =>
        Math.abs(existing.left - rect.left) <= 4 &&
        Math.abs(existing.top - rect.top) <= 4 &&
        Math.abs(existing.width - rect.width) <= 8 &&
        Math.abs(existing.height - rect.height) <= 8
    );
    if (!duplicate) unique.push(rect);
  }
  return unique;
}

async function detectBoxedFrameRects(buffer: Buffer): Promise<PixelRect[]> {
  const { data, width, height } = await readNormalizedGrayscale(buffer);
  const horizontal = collectLineSegments({
    data,
    width,
    height,
    direction: 'horizontal',
    minLength: Math.max(28, Math.floor(width * 0.015)),
    maxLength: Math.max(120, Math.floor(width * 0.45))
  });
  const vertical = collectLineSegments({
    data,
    width,
    height,
    direction: 'vertical',
    minLength: Math.max(10, Math.floor(height * 0.008)),
    maxLength: Math.max(80, Math.floor(height * 0.18))
  });
  const minFrameWidth = Math.max(34, Math.floor(width * 0.018));
  const minFrameHeight = Math.max(12, Math.floor(height * 0.006));
  const maxFrameHeight = Math.max(90, Math.floor(height * 0.12));
  const tolerance = Math.max(3, Math.floor(Math.min(width, height) * 0.003));
  const rects: PixelRect[] = [];

  for (let i = 0; i < horizontal.length; i += 1) {
    const topLine = horizontal[i]!;
    for (let j = i + 1; j < horizontal.length; j += 1) {
      const bottomLine = horizontal[j]!;
      const frameHeight = bottomLine.fixed - topLine.fixed;
      if (frameHeight < minFrameHeight) continue;
      if (frameHeight > maxFrameHeight) break;
      if (!overlaps(topLine, bottomLine, minFrameWidth)) continue;
      const left = Math.max(topLine.start, bottomLine.start);
      const right = Math.min(topLine.end, bottomLine.end);
      if (right - left < minFrameWidth) continue;
      if (!hasVerticalBorder(vertical, left, topLine.fixed, bottomLine.fixed, tolerance)) continue;
      if (!hasVerticalBorder(vertical, right, topLine.fixed, bottomLine.fixed, tolerance)) continue;
      rects.push(
        expandRect(
          {
            left,
            top: topLine.fixed,
            width: right - left + 1,
            height: frameHeight + 1
          },
          width,
          height,
          Math.max(6, tolerance * 2)
        )
      );
    }
  }

  return dedupeRects(rects)
    .sort((a, b) => a.width * a.height - b.width * b.height)
    .slice(0, Math.floor(MAX_FRAME_PASSES / 3));
}

async function renderPassImage(buffer: Buffer, pass: OcrPass): Promise<{ buffer: Buffer; width: number; height: number }> {
  const crop = sharp(buffer, { failOn: 'none' }).extract(pass.rect);
  const source =
    pass.rotation === 90 || pass.rotation === 270
      ? sharp(await crop.toBuffer(), { failOn: 'none' }).rotate(pass.rotation)
      : crop.rotate(pass.rotation);
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
    const lineSuppressedBuffer = await suppressLongDrawingLines(buffer);
    const frameRects = await detectBoxedFrameRects(buffer);
    const passGroups: Array<{ buffer: Buffer; passes: OcrPass[] }> = [
      { buffer, passes: buildBaseOcrPasses(width, height, 'raw') },
      { buffer: lineSuppressedBuffer, passes: buildBaseOcrPasses(width, height, 'lineSuppressed') },
      { buffer: lineSuppressedBuffer, passes: buildFrameOcrPasses(frameRects) }
    ];

    for (const group of passGroups) {
      for (const pass of group.passes) {
        if (tokens.length >= MAX_TOKENS) break;
        // eslint-disable-next-line no-await-in-loop
        const passImage = await renderPassImage(group.buffer, pass);
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
            preprocessKind: pass.preprocessKind,
            rotation: pass.rotation
          });
          if (tokens.length >= MAX_TOKENS) break;
        }
      }
      if (tokens.length >= MAX_TOKENS) break;
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
