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
    markerXRatio: String(proposal ? Math.min(1, anchorX + 0.03) : xRatio),
    markerYRatio: String(proposal ? Math.max(0, anchorY - 0.03) : yRatio),
    calloutTipXRatio: proposal ? String(anchorX) : null,
    calloutTipYRatio: proposal ? String(anchorY) : null
  });
}

export function filterExistingPlacementRows<T extends DrawingPlacementRow>(
  rows: T[],
  points: InspectionDrawingPoint[]
): T[] {
  return rows.filter((row) => !points.some((point) =>
    point.name === row.measurementLabel &&
    point.nominalRaw.trim() !== '' &&
    Number(point.nominalRaw) === row.nominalValue
  ));
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
