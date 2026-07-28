import { resolveMeasurementPointInputStatus } from './inspection-drawing/measurementPointInputStatus';

import type { InspectionDrawingPoint } from './inspection-drawing/types';

export type SelfInspectionOutOfToleranceUiState = {
  pointId: string;
  acknowledged: boolean;
  label: 'NG・未確認' | 'NG・確認済み';
};

export type SelfInspectionMeasurementStatusOverride = {
  label: string;
  tone: 'danger' | 'warning';
};

export function buildSelfInspectionOutOfToleranceAcknowledgements(
  values: Array<{
    templateItemId: string;
    outOfToleranceAcknowledgedAt?: string | null;
  }>
): Record<string, boolean> {
  return Object.fromEntries(
    values
      .filter((value) => value.outOfToleranceAcknowledgedAt != null)
      .map((value) => [value.templateItemId, true])
  );
}

export function resolveSelfInspectionOutOfToleranceUiState(
  point: InspectionDrawingPoint | null,
  acknowledgedByPointId: Record<string, boolean>
): SelfInspectionOutOfToleranceUiState | null {
  if (
    !point ||
    point.valueKind === 'judgement' ||
    resolveMeasurementPointInputStatus(point) !== 'ng'
  ) {
    return null;
  }
  const acknowledged = acknowledgedByPointId[point.id] === true;
  return {
    pointId: point.id,
    acknowledged,
    label: acknowledged ? 'NG・確認済み' : 'NG・未確認'
  };
}

export function buildSelfInspectionMeasurementStatusOverrides(
  points: InspectionDrawingPoint[],
  acknowledgedByPointId: Record<string, boolean>
): Record<string, SelfInspectionMeasurementStatusOverride> {
  return Object.fromEntries(
    points.flatMap((point) => {
      const state = resolveSelfInspectionOutOfToleranceUiState(point, acknowledgedByPointId);
      if (!state) return [];
      return [
        [
          point.id,
          {
            label: state.label,
            tone: state.acknowledged ? 'warning' : 'danger'
          }
        ]
      ];
    })
  );
}
