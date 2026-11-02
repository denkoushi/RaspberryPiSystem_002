import { api } from '../http';

import type { PartMeasurementProcessGroup } from '../../features/part-measurement/types';

export type DrawingPlacementRow = {
  id: string;
  measurementLabel: string;
  measurementPoint: string | null;
  nominalValue: number;
  lowerLimit: number | null;
  upperLimit: number | null;
  depthMode: 'measured' | 'through';
  valueKind: 'numeric' | 'judgement';
  decimalPlaces: number;
};

export type DrawingPlacementProposal = DrawingPlacementRow & {
  sortOrder: number;
  markerXRatio: number | null;
  markerYRatio: number | null;
  anchorXRatio: number | null;
  anchorYRatio: number | null;
  dimensionText: string | null;
};

export type DrawingPlacementUnplaced = DrawingPlacementRow & { reason: 'no-candidate' };

export type DrawingPlacementResponse = {
  status: 'ready' | 'map-pending' | 'no-sibling';
  sourceDrawingName: string | null;
  proposals: DrawingPlacementProposal[];
  unplaced: DrawingPlacementUnplaced[];
};

export async function getInspectionDrawingPlacementProposals(visualTemplateId: string, processGroup: PartMeasurementProcessGroup, clientKey?: string) {
  const { data } = await api.get<DrawingPlacementResponse>(
    `/part-measurement/visual-templates/${visualTemplateId}/placement-proposals`,
    { params: { processGroup }, headers: clientKey ? { 'x-client-key': clientKey } : undefined }
  );
  return data;
}

export async function postInspectionDrawingPlacementDecisions(
  visualTemplateId: string,
  body: { approvedIds?: string[]; rejectedIds?: string[] },
  clientKey?: string
) {
  const { data } = await api.post<{ updated: number }>(
    `/part-measurement/visual-templates/${visualTemplateId}/placement-proposals/decisions`,
    body,
    { headers: clientKey ? { 'x-client-key': clientKey } : undefined }
  );
  return data;
}
