import type { InspectionDrawingPoint } from './types';

export const INSPECTION_DRAWING_SURFACE_SIDE_OPTIONS = ['正面', '背面', '両面'] as const;

export const INSPECTION_DRAWING_THREAD_NOMINAL_OPTIONS = [
  'M3',
  'M3.5',
  'M4',
  'M4.5',
  'M5',
  'M6',
  'M7',
  'M8',
  'M9',
  'M10',
  'M11',
  'M12',
  'M14',
  'M16',
  'M18',
  'M20',
  'M22',
  'M24',
  'M27',
  'M30'
] as const;

const SURFACE_SIDE_SET = new Set<string>(INSPECTION_DRAWING_SURFACE_SIDE_OPTIONS);
const THREAD_NOMINAL_SET = new Set<string>(INSPECTION_DRAWING_THREAD_NOMINAL_OPTIONS);

type SupplementFields = Pick<InspectionDrawingPoint, 'threadNominal' | 'surfaceSide' | 'supplementText'>;

export function normalizeInspectionDrawingSupplementText(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeThreadNominal(raw: string | null | undefined): string {
  const value = normalizeInspectionDrawingSupplementText(raw);
  return THREAD_NOMINAL_SET.has(value) ? value : '';
}

function normalizeSurfaceSide(raw: string | null | undefined): string {
  const value = normalizeInspectionDrawingSupplementText(raw);
  return SURFACE_SIDE_SET.has(value) ? value : '';
}

export function buildInspectionDrawingPointSupplementParts(point: SupplementFields): string[] {
  const parts = [
    normalizeThreadNominal(point.threadNominal),
    normalizeSurfaceSide(point.surfaceSide),
    normalizeInspectionDrawingSupplementText(point.supplementText)
  ];
  return parts.filter((part) => part.length > 0);
}

export function formatInspectionDrawingPointDisplayName(
  point: Pick<InspectionDrawingPoint, 'name' | 'threadNominal' | 'surfaceSide' | 'supplementText'>,
  fallbackLabel = '測定点'
): string {
  const label = normalizeInspectionDrawingSupplementText(point.name) || fallbackLabel;
  const supplementParts = buildInspectionDrawingPointSupplementParts(point);
  if (supplementParts.length === 0) {
    return label;
  }
  return `${label} / ${supplementParts.join(' / ')}`;
}

export function buildInspectionDrawingMeasurementPoint(label: string, point: SupplementFields): string {
  const normalizedLabel = normalizeInspectionDrawingSupplementText(label);
  const supplementParts = buildInspectionDrawingPointSupplementParts(point);
  if (supplementParts.length === 0) {
    return normalizedLabel;
  }
  return `${normalizedLabel} ${supplementParts.join(' ')}`;
}

export function parseInspectionDrawingMeasurementPointSupplement(input: {
  measurementLabel: string | null | undefined;
  measurementPoint: string | null | undefined;
}): {
  threadNominal: string;
  surfaceSide: string;
  supplementText: string;
} {
  const label = normalizeInspectionDrawingSupplementText(input.measurementLabel);
  const point = normalizeInspectionDrawingSupplementText(input.measurementPoint);
  if (!label || !point.startsWith(`${label} `)) {
    return { threadNominal: '', surfaceSide: '', supplementText: '' };
  }

  const tokens = point.slice(label.length).trim().split(/\s+/).filter(Boolean);
  let threadNominal = '';
  let surfaceSide = '';
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (!threadNominal && THREAD_NOMINAL_SET.has(token)) {
      threadNominal = token;
      index += 1;
      continue;
    }
    if (!surfaceSide && SURFACE_SIDE_SET.has(token)) {
      surfaceSide = token;
      index += 1;
      continue;
    }
    break;
  }

  return {
    threadNominal,
    surfaceSide,
    supplementText: tokens.slice(index).join(' ')
  };
}
