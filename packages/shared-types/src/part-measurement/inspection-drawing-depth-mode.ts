export type InspectionDrawingDepthMode = 'measured' | 'through';

export const INSPECTION_DRAWING_DEPTH_MODE_MEASURED: InspectionDrawingDepthMode = 'measured';
export const INSPECTION_DRAWING_DEPTH_MODE_THROUGH: InspectionDrawingDepthMode = 'through';

export const INSPECTION_DRAWING_DEPTH_MODE_LABELS = new Set(['深さ', 'ネジ穴深さ', 'キリ穴深さ']);

export function isInspectionDrawingDepthLabel(label: string | null | undefined): boolean {
  return INSPECTION_DRAWING_DEPTH_MODE_LABELS.has(String(label ?? '').trim());
}

export function normalizeInspectionDrawingDepthMode(
  value: string | null | undefined
): InspectionDrawingDepthMode {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === INSPECTION_DRAWING_DEPTH_MODE_THROUGH) {
    return INSPECTION_DRAWING_DEPTH_MODE_THROUGH;
  }
  return INSPECTION_DRAWING_DEPTH_MODE_MEASURED;
}

export function isInspectionDrawingThroughDepthMode(
  value: string | null | undefined
): boolean {
  return normalizeInspectionDrawingDepthMode(value) === INSPECTION_DRAWING_DEPTH_MODE_THROUGH;
}

/** Sentinel absolute limits for THROUGH rows (template validity requires non-null limits). */
export const INSPECTION_DRAWING_THROUGH_SENTINEL_LIMIT = 0;
