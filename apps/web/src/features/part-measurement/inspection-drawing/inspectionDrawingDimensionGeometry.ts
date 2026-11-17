import type { InspectionDrawingCalloutDim } from './types';

type Position = { x: number; y: number };
export type DimensionLine = { start: Position; end: Position };

/** All coordinates use the same image rectangle as the callout overlay. */
export function computeDimensionGeometry(
  dim: InspectionDrawingCalloutDim,
  tipXRatio: number,
  tipYRatio: number,
  image: { width: number; height: number; offsetX: number; offsetY: number }
) {
  const base = { x: image.offsetX + dim.baseXRatio * image.width, y: image.offsetY + dim.baseYRatio * image.height };
  const tip = { x: image.offsetX + tipXRatio * image.width, y: image.offsetY + tipYRatio * image.height };
  const offset = dim.dir === 'x' ? image.offsetY + dim.offsetRatio * image.height : image.offsetX + dim.offsetRatio * image.width;
  const start = dim.dir === 'x' ? { x: base.x, y: offset } : { x: offset, y: base.y };
  const end = dim.dir === 'x' ? { x: tip.x, y: offset } : { x: offset, y: tip.y };
  // The approved mock extends the auxiliary lines 10 units beyond the dimension.
  const extension = (point: Position): DimensionLine => ({ start: point, end: dim.dir === 'x'
    ? { x: point.x, y: offset + Math.sign(offset - point.y || -1) * image.height * 10 / 640 }
    : { x: offset + Math.sign(offset - point.x || 1) * image.width * 10 / 1000, y: point.y } });
  return { lines: [extension(base), extension(tip), { start, end }], base,
    handle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
}
