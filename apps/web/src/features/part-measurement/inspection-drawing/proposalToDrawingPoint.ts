import { nextAvailableMarkerNo, templateItemToDrawingPoint } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';
import type { DrawingPlacementProposal, DrawingPlacementRow, DrawingPlacementUnplaced } from '../../../api/domains/part-measurement-placement';

export function proposalToDrawingPoint(
  row: DrawingPlacementProposal | DrawingPlacementUnplaced,
  points: InspectionDrawingPoint[],
  xRatio: number,
  yRatio: number
): InspectionDrawingPoint {
  const markerNo = nextAvailableMarkerNo(points);
  const proposal = 'reason' in row ? null : row;
  const hasAnchor = proposal?.anchorXRatio != null && proposal.anchorYRatio != null;
  const anchorX = hasAnchor ? proposal.anchorXRatio! : xRatio;
  const anchorY = hasAnchor ? proposal.anchorYRatio! : yRatio;
  return templateItemToDrawingPoint({
    ...row,
    id: crypto.randomUUID(),
    sortOrder: markerNo - 1,
    displayMarker: String(markerNo),
    measurementPoint: row.measurementPoint ?? '',
    datumSurface: '',
    unit: 'mm',
    allowNegative: true,
    nominalValue: String(row.nominalValue),
    lowerLimit: row.lowerLimit === null ? null : String(row.lowerLimit),
    upperLimit: row.upperLimit === null ? null : String(row.upperLimit),
    markerXRatio: String(proposal && !proposal.markerAtRatio ? Math.min(1, anchorX + 0.03) : xRatio),
    markerYRatio: String(proposal && !proposal.markerAtRatio ? Math.max(0, anchorY - 0.03) : yRatio),
    // A marker placed beside the dimension needs no tip; the tip badge would sit on the dimension text.
    calloutTipXRatio: proposal && !proposal.markerAtRatio ? String(anchorX) : null,
    calloutTipYRatio: proposal && !proposal.markerAtRatio ? String(anchorY) : null,
    calloutDims: []
  });
}

/** Baseline twin proposals (same label and nominal in another view) stay visible when the existing point is farther than this (ratio units). */
export const BASELINE_TWIN_NEAR_DISTANCE = 0.06;

const isNear = (point: InspectionDrawingPoint, x: number | null | undefined, y: number | null | undefined) =>
  x != null && y != null && Math.hypot(point.xRatio - x, point.yRatio - y) <= BASELINE_TWIN_NEAR_DISTANCE;

export function filterExistingPlacementRows<T extends DrawingPlacementRow>(
  rows: T[],
  points: InspectionDrawingPoint[]
): T[] {
  return rows.filter((row) => !points.some((point) => {
    const sameItem = point.name === row.measurementLabel &&
      point.nominalRaw.trim() !== '' &&
      Number(point.nominalRaw) === row.nominalValue;
    if (!sameItem) return false;
    if (!('markerAtRatio' in row && row.markerAtRatio)) return true;
    const proposal = row as unknown as DrawingPlacementProposal;
    return isNear(point, proposal.markerXRatio, proposal.markerYRatio) ||
      isNear(point, proposal.anchorXRatio, proposal.anchorYRatio);
  }));
}

export type DrawingProposalMarker = DrawingPlacementProposal & {
  markerNo: number;
  markerXRatio: number;
  markerYRatio: number;
};

export function numberPlacementProposals(
  proposals: DrawingPlacementProposal[],
  points: InspectionDrawingPoint[]
): DrawingProposalMarker[] {
  const max = points.reduce((value, point) => Math.max(value, point.markerNo), 0);
  return proposals
    .filter((row): row is DrawingPlacementProposal & { markerXRatio: number; markerYRatio: number } =>
      row.markerXRatio !== null && row.markerYRatio !== null
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row, index) => ({ ...row, markerNo: max + 1 + index }));
}
