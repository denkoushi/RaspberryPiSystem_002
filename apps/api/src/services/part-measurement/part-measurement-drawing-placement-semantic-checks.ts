import type { PartMeasurementDrawingDimension } from './part-measurement-drawing-dimension-map-payload.js';

const GEOMETRIC_LABEL = /平面度|平行度|直角度|真円度|円筒度|同軸度|同心度|真直度|位置度|振れ|傾斜度|対称度|輪郭度/;

export function semanticPlacementRejections(assignments: {
  measurementLabel: string;
  target: string | null;
  dimension: PartMeasurementDrawingDimension | null;
}[]): (string | null)[] {
  const rejections = assignments.map(({ measurementLabel, target, dimension }) => {
    if (!dimension || !target) return null;
    const text = dimension.text.normalize('NFKC').trim();
    if (dimension.kind === 'ref' || /^\(.*\)$/s.test(text)) return 'reference-dimension';
    if (GEOMETRIC_LABEL.test(measurementLabel) !== (dimension.kind === 'gdt')) return 'geometric-kind-mismatch';
    if (/深/.test(measurementLabel) && dimension.depth === null && /^(?:\d+\s*[-×x]\s*)?[φΦ⌀øØ]/u.test(text)) return 'depth-to-diameter';
    if ((!/粗さ|粗度|Ra|Rz/i.test(measurementLabel) && /Ra|Rz|▽/i.test(text)) || !/\d/.test(text) ||
      (dimension.kind === 'other' && !Number.isFinite(dimension.nominal))) return 'annotation-or-roughness';
    return null;
  });
  const used = new Set<string>();
  return assignments.map(({ target, dimension }, i) => {
    if (rejections[i] || !dimension || !target) return rejections[i];
    if (dimension.kind !== 'gdt' && used.has(target)) return 'duplicate-dimension';
    used.add(target);
    return null;
  });
}
