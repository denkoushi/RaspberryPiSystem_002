import { nextAvailableMarkerNo, templateItemToDrawingPoint } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';
import type { DrawingPlacementProposal, DrawingPlacementRow } from '../../../api/domains/part-measurement-placement';

export function proposalToDrawingPoint(
  row: DrawingPlacementRow,
  points: InspectionDrawingPoint[],
  xRatio: number,
  yRatio: number
): InspectionDrawingPoint {
  const markerNo = nextAvailableMarkerNo(points);
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
    markerXRatio: String(xRatio),
    markerYRatio: String(yRatio)
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
