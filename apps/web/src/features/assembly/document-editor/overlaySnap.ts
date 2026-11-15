import type { AssemblyProcedureCropRect, AssemblyProcedureOverlayBBox as BBox } from '@raspi-system/shared-types';

export type SnapGuide = { axis: 'x' | 'y'; coordinate: number };
export type SnapMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/** Coordinates stay in source-page ratios; tolerances are measured in displayed pixels. */
export function snapOverlayBBox({ bbox, targets, viewport, crop, mode = 'move', thresholdPx = 6 }: {
  bbox: BBox;
  targets: BBox[];
  viewport: { width: number; height: number };
  crop?: AssemblyProcedureCropRect | null;
  mode?: SnapMode;
  thresholdPx?: number;
}): { bbox: BBox; guides: SnapGuide[] } {
  const result = { ...bbox };
  const guides: SnapGuide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const position = axis === 'x' ? 'xRatio' : 'yRatio';
    const size = axis === 'x' ? 'widthRatio' : 'heightRatio';
    const pixels = axis === 'x' ? viewport.width : viewport.height;
    if (pixels <= 0) continue;
    const scale = crop?.[size] ?? 1;
    const threshold = thresholdPx * scale / pixels;
    const candidates = [0, 0.5, 1, ...targets.flatMap(target => [target[position], target[position] + target[size] / 2, target[position] + target[size]])];
    const movingStart = axis === 'x' ? mode.includes('w') : mode.includes('n');
    const offsets = mode === 'move' ? [0, bbox[size] / 2, bbox[size]] : [movingStart ? 0 : bbox[size]];
    let best: { delta: number; coordinate: number } | undefined;
    for (const offset of offsets) {
      for (const coordinate of candidates) {
        const delta = coordinate - bbox[position] - offset;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9)) best = { delta, coordinate };
      }
    }
    if (!best) continue;
    if (mode === 'move') result[position] = Math.max(0, Math.min(1 - bbox[size], bbox[position] + best.delta));
    else if (movingStart) {
      const end = bbox[position] + bbox[size];
      result[position] = Math.max(0, Math.min(end - 0.005, bbox[position] + best.delta));
      result[size] = end - result[position];
    } else result[size] = Math.max(0.005, Math.min(1 - bbox[position], bbox[size] + best.delta));
    const anchors = mode === 'move' ? [result[position], result[position] + result[size] / 2, result[position] + result[size]] : [result[position] + (movingStart ? 0 : result[size])];
    if (anchors.some(anchor => Math.abs(anchor - best.coordinate) < 1e-9)) guides.push({ axis, coordinate: best.coordinate });
  }
  return { bbox: result, guides };
}

export function centerMaterialBBox(size: Pick<BBox, 'widthRatio' | 'heightRatio'>, target: BBox): BBox {
  return {
    ...size,
    xRatio: Math.max(0, Math.min(1 - size.widthRatio, target.xRatio + target.widthRatio / 2 - size.widthRatio / 2)),
    yRatio: Math.max(0, Math.min(1 - size.heightRatio, target.yRatio + target.heightRatio / 2 - size.heightRatio / 2))
  };
}
