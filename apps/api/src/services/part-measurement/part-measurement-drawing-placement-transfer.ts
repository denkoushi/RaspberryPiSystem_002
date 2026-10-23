import {
  candidateValue,
  matchesWantedKind,
  resolveWantedDimensionKind
} from './part-measurement-drawing-dimension-map-candidates.js';
import type {
  PartMeasurementDrawingDimension,
  PartMeasurementDrawingDimensionMapPayload
} from './part-measurement-drawing-dimension-map-payload.js';

export type DimensionMap = Pick<PartMeasurementDrawingDimensionMapPayload, 'image' | 'dimensions'>;
export type PlacementExistingItem = { measurementLabel: string; nominalValue: number | null };
export type PlacementSourceItem = {
  id: string;
  sortOrder: number;
  measurementLabel: string;
  nominalValue: number;
  lowerLimit: number | null;
  upperLimit: number | null;
  depthMode: 'MEASURED' | 'THROUGH';
  valueKind: 'NUMERIC' | 'JUDGEMENT';
  markerXRatio: number;
  markerYRatio: number;
  calloutTipXRatio: number | null;
  calloutTipYRatio: number | null;
};
export type PlacementDimension = Pick<PartMeasurementDrawingDimension, 'text' | 'xRatio' | 'yRatio' | 'kind'>;
export type PlacementCandidate = PlacementDimension & { distance: number; score?: number };
export type PlacementReorder = (
  item: PlacementSourceItem,
  candidates: PlacementCandidate[]
) => Promise<PlacementCandidate[]>;
export type PlacementTransferResult = {
  item: PlacementSourceItem;
  status: 'PROPOSED' | 'UNPLACED';
  dimension: PlacementDimension | null;
  markerXRatio: number | null;
  markerYRatio: number | null;
  candidates: PlacementCandidate[];
};

export function drawingNameFamily(name: string): string {
  return name.normalize('NFKC')
    .replace(/^3351-MD\p{Decimal_Number}+\s*/u, '')
    .replace(/^7161/, '')
    .replace(/MD\p{Decimal_Number}+/gu, '')
    .replace(/\(.*?\)/g, '')
    .replace(/^(X軸|Y軸|Z軸|本体|Y)/, '')
    .trim();
}

export function placementItemAlreadyExists(item: PlacementExistingItem, existing: PlacementExistingItem[]): boolean {
  return existing.some((other) =>
    other.measurementLabel === item.measurementLabel && other.nominalValue === item.nominalValue
  );
}

function aspect(map: DimensionMap): number {
  return map.image.width > 0 && map.image.height > 0 ? map.image.width / map.image.height : 1;
}

function distance(map: DimensionMap, ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, (ay - by) / aspect(map));
}

function itemDistance(map: DimensionMap, item: PlacementSourceItem, dimension: PlacementDimension): number {
  const marker = distance(map, item.markerXRatio, item.markerYRatio, dimension.xRatio, dimension.yRatio);
  if (item.calloutTipXRatio === null || item.calloutTipYRatio === null) return marker;
  return Math.min(marker, distance(map, item.calloutTipXRatio, item.calloutTipYRatio, dimension.xRatio, dimension.yRatio));
}

function valueMatched(map: DimensionMap, item: PlacementSourceItem, requireKind: boolean): PartMeasurementDrawingDimension[] {
  const wanted = resolveWantedDimensionKind(item.measurementLabel, item.depthMode === 'THROUGH' ? 'through' : 'measured');
  return map.dimensions.filter((dimension) => {
    const value = candidateValue(dimension, wanted);
    return value !== null && Math.abs(value - item.nominalValue) < 1e-6 &&
      (!requireKind || matchesWantedKind(dimension, wanted));
  });
}

export function sourceItemDimension(map: DimensionMap | null, item: PlacementSourceItem): PlacementDimension | null {
  if (!map) return null;
  // The offline gold_dim rule matches value, regardless of kind.
  const own = valueMatched(map, item, false)
    .sort((a, b) => itemDistance(map, item, a) - itemDistance(map, item, b))[0];
  return own && itemDistance(map, item, own) <= 0.07 ? own : null;
}

function candidatesFor(map: DimensionMap, item: PlacementSourceItem): PlacementCandidate[] {
  const wanted = resolveWantedDimensionKind(item.measurementLabel, item.depthMode === 'THROUGH' ? 'through' : 'measured');
  const unique: PartMeasurementDrawingDimension[] = [];
  for (const dimension of valueMatched(map, item, true)) {
    if (unique.some((other) => candidateValue(other, wanted) === candidateValue(dimension, wanted) &&
      distance(map, other.xRatio, other.yRatio, dimension.xRatio, dimension.yRatio) < 0.01)) continue;
    unique.push(dimension);
  }
  return unique.map(({ text, xRatio, yRatio, kind }) => ({
    text, xRatio, yRatio, kind, distance: itemDistance(map, item, { text, xRatio, yRatio, kind })
  })).sort((a, b) => a.distance - b.distance);
}

export async function transferItems(input: {
  targetMap: DimensionMap;
  sourceItems: PlacementSourceItem[];
  sourceMap: DimensionMap | null;
  existingItems: PlacementExistingItem[];
  reorder?: PlacementReorder;
}): Promise<PlacementTransferResult[]> {
  const results: PlacementTransferResult[] = [];
  for (const item of input.sourceItems) {
    if (placementItemAlreadyExists(item, input.existingItems)) continue;
    let candidates = candidatesFor(input.targetMap, item);
    if (input.reorder && candidates.length > 1) {
      // Sequential so a later image ranking provider does not fan out inference requests.
      // eslint-disable-next-line no-await-in-loop
      candidates = await input.reorder(item, candidates);
    }
    const chosen = candidates[0];
    if (!chosen) {
      results.push({ item, status: 'UNPLACED', dimension: null, markerXRatio: null, markerYRatio: null, candidates });
      continue;
    }
    let offsetX = 0.02;
    let offsetY = -0.02;
    const own = sourceItemDimension(input.sourceMap, item);
    if (own) {
      offsetX = item.markerXRatio - own.xRatio;
      offsetY = item.markerYRatio - own.yRatio;
    }
    const { text, xRatio, yRatio, kind } = chosen;
    results.push({
      item,
      status: 'PROPOSED',
      dimension: { text, xRatio, yRatio, kind },
      markerXRatio: Math.min(0.99, Math.max(0.01, xRatio + offsetX)),
      markerYRatio: Math.min(0.99, Math.max(0.01, yRatio + offsetY)),
      candidates
    });
  }
  return results;
}

export type PlacementSibling = {
  id: string;
  name: string;
  isActive: boolean;
  templates: {
    id: string;
    isActive: boolean;
    updatedAt: Date;
    items: PlacementSourceItem[];
  }[];
};

export function chooseSourceSibling(input: {
  target: { id: string; name: string };
  targetMap: DimensionMap;
  siblings: PlacementSibling[];
}): { sibling: PlacementSibling; template: PlacementSibling['templates'][number] } | null {
  const ranked = input.siblings
    .filter((sibling) => sibling.id !== input.target.id && sibling.isActive)
    .flatMap((sibling, rank) => sibling.templates
      .filter((template) => template.isActive && template.items.length > 0)
      .map((template) => ({
        sibling,
        template,
        rank,
        count: template.items.filter((item) => candidatesFor(input.targetMap, item).length > 0).length
      })))
    .sort((a, b) => b.count - a.count || b.template.updatedAt.getTime() - a.template.updatedAt.getTime() || a.rank - b.rank);
  return ranked[0] ? { sibling: ranked[0].sibling, template: ranked[0].template } : null;
}
