import sharp from 'sharp';

export type DrawingLocalOcrPixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DrawingLocalOcrRotation = 0 | 90 | 270;

export const DRAWING_LOCAL_OCR_ROTATIONS: DrawingLocalOcrRotation[] = [0, 90, 270];
export const DRAWING_LOCAL_OCR_MAX_LONG_EDGE = 900;
export const DRAWING_LOCAL_OCR_DEFAULT_HALF_RATIO = 0.055;
export const DRAWING_LOCAL_OCR_DEPTH_HALF_RATIO = 0.11;
export const DRAWING_LOCAL_OCR_DEPTH_ANNULUS_INNER = 0.06;
export const DRAWING_LOCAL_OCR_DEPTH_ANNULUS_OUTER = 0.14;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function buildCenteredRect(
  xRatio: number,
  yRatio: number,
  halfRatio: number,
  imageWidth: number,
  imageHeight: number
): DrawingLocalOcrPixelRect {
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

export function buildAnnulusRects(
  xRatio: number,
  yRatio: number,
  imageWidth: number,
  imageHeight: number
): DrawingLocalOcrPixelRect[] {
  const cx = clamp01(xRatio) * imageWidth;
  const cy = clamp01(yRatio) * imageHeight;
  const inner = Math.max(
    32,
    Math.floor(Math.min(imageWidth, imageHeight) * DRAWING_LOCAL_OCR_DEPTH_ANNULUS_INNER)
  );
  const outer = Math.max(
    inner + 16,
    Math.floor(Math.min(imageWidth, imageHeight) * DRAWING_LOCAL_OCR_DEPTH_ANNULUS_OUTER)
  );
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

export function listLocalOcrRects(input: {
  xRatio: number;
  yRatio: number;
  depthSearch?: boolean;
  imageWidth: number;
  imageHeight: number;
}): DrawingLocalOcrPixelRect[] {
  const halfRatio = input.depthSearch
    ? DRAWING_LOCAL_OCR_DEPTH_HALF_RATIO
    : DRAWING_LOCAL_OCR_DEFAULT_HALF_RATIO;
  const rects: DrawingLocalOcrPixelRect[] = [
    buildCenteredRect(input.xRatio, input.yRatio, halfRatio, input.imageWidth, input.imageHeight)
  ];
  if (input.depthSearch) {
    rects.push(
      ...buildAnnulusRects(input.xRatio, input.yRatio, input.imageWidth, input.imageHeight).slice(0, 2)
    );
  }
  return rects;
}

function rotatedUnscaledSize(
  rect: DrawingLocalOcrPixelRect,
  rotation: DrawingLocalOcrRotation
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: rect.height, height: rect.width }
    : { width: rect.width, height: rect.height };
}

function rotatedPointToCropPoint(
  x: number,
  y: number,
  rect: DrawingLocalOcrPixelRect,
  rotation: DrawingLocalOcrRotation
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

export function mapBboxToOriginalRatios(input: {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  ocrWidth: number;
  ocrHeight: number;
  rect: DrawingLocalOcrPixelRect;
  rotation: DrawingLocalOcrRotation;
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

export async function renderLocalOcrPass(
  buffer: Buffer,
  rect: DrawingLocalOcrPixelRect,
  rotation: DrawingLocalOcrRotation
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const crop = sharp(buffer, { failOn: 'none' }).extract(rect);
  const source =
    rotation === 90 || rotation === 270
      ? sharp(await crop.toBuffer(), { failOn: 'none' }).rotate(rotation)
      : crop;
  const rendered = await source
    .resize({
      width: DRAWING_LOCAL_OCR_MAX_LONG_EDGE,
      height: DRAWING_LOCAL_OCR_MAX_LONG_EDGE,
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

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function readLocalOcrTimeoutMs(): number {
  return Math.max(
    1000,
    Number.parseInt(process.env.PART_MEASUREMENT_DRAWING_OCR_LOCAL_TIMEOUT_MS || '8000', 10) || 8000
  );
}
