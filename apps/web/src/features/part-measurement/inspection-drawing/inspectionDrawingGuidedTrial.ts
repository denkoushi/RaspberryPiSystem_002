import {
  parseMeasurementNumber,
  statusForPoint
} from './evaluateMeasurement';
import { toleranceBoundsFromPoint } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';

export type GuidedTrialValueCommitSource = 'dropdown' | 'enter' | 'blur' | 'blur_without_guide' | 'manual_switch';

export type GuidedTrialValueCommitPayload = {
  pointId: string;
  value: string;
  source: GuidedTrialValueCommitSource;
};

export type GuidedTrialPointInputStatus = 'empty' | 'ok' | 'ng' | 'tolerance_error' | 'invalid';

export type GuidedTrialFocusRequest = {
  pointId: string;
  requestId: number;
  zoom: number;
};

export type GuidedTrialFocusTarget = {
  pointId: string;
  zoom: number;
  focusRequest: GuidedTrialFocusRequest;
};

export const GUIDED_TRIAL_ZOOM = 1.5;

export function sortGuidedTrialPointsStable(points: InspectionDrawingPoint[]): InspectionDrawingPoint[] {
  return [...points]
    .map((point, index) => ({ point, index }))
    .sort((a, b) => {
      if (a.point.markerNo !== b.point.markerNo) return a.point.markerNo - b.point.markerNo;
      if (a.index !== b.index) return a.index - b.index;
      return a.point.id.localeCompare(b.point.id);
    })
    .map(({ point }) => point);
}

export function resolveGuidedTrialPointInputStatus(point: InspectionDrawingPoint): GuidedTrialPointInputStatus {
  const bounds = toleranceBoundsFromPoint(point);
  if ('error' in bounds) return 'tolerance_error';
  const parsed = parseMeasurementNumber(point.testValue);
  if (parsed === null) {
    return point.testValue.trim() === '' ? 'empty' : 'invalid';
  }
  return statusForPoint(point.testValue, bounds.lowerLimit, bounds.upperLimit);
}

export function shouldAdvanceGuidedTrialOnCommit(source: GuidedTrialValueCommitSource): boolean {
  return source === 'dropdown' || source === 'enter' || source === 'blur';
}

export function resolveGuidedTrialInitialTarget(
  points: InspectionDrawingPoint[],
  requestId: number
): GuidedTrialFocusTarget | null {
  const pointId = findFirstPendingGuidedTrialPointId(points);
  if (!pointId) return null;
  return createGuidedTrialFocusTarget(pointId, requestId);
}

export function resolveGuidedTrialResumeTarget(
  points: InspectionDrawingPoint[],
  requestId: number
): GuidedTrialFocusTarget | null {
  return resolveGuidedTrialInitialTarget(points, requestId);
}

function findFirstPendingGuidedTrialPointId(points: InspectionDrawingPoint[]): string | null {
  const sorted = sortGuidedTrialPointsStable(points);
  return sorted.find((pt) => resolveGuidedTrialPointInputStatus(pt) !== 'ok')?.id ?? null;
}

function findNextGuidedTrialPointIdAfter(points: InspectionDrawingPoint[], afterPointId: string): string | null {
  const sorted = sortGuidedTrialPointsStable(points);
  const afterIndex = sorted.findIndex((pt) => pt.id === afterPointId);
  if (afterIndex < 0) return findFirstPendingGuidedTrialPointId(points);
  for (let i = afterIndex + 1; i < sorted.length; i += 1) {
    if (resolveGuidedTrialPointInputStatus(sorted[i]!) !== 'ok') return sorted[i]!.id;
  }
  return null;
}

export function createGuidedTrialFocusTarget(
  pointId: string,
  requestId: number,
  zoom = GUIDED_TRIAL_ZOOM
): GuidedTrialFocusTarget {
  return {
    pointId,
    zoom,
    focusRequest: { pointId, requestId, zoom }
  };
}

export function applyGuidedTrialValue(input: {
  points: InspectionDrawingPoint[];
  commit: GuidedTrialValueCommitPayload;
  nextFocusRequestId: number;
}):
  | {
      kind: 'stay';
      points: InspectionDrawingPoint[];
      pointId: string;
      inputStatus: GuidedTrialPointInputStatus;
    }
  | {
      kind: 'advance';
      points: InspectionDrawingPoint[];
      pointId: string;
      next: GuidedTrialFocusTarget | null;
    } {
  const nextPoints = input.points.map((pt) =>
    pt.id === input.commit.pointId ? { ...pt, testValue: input.commit.value } : pt
  );
  const committed = nextPoints.find((pt) => pt.id === input.commit.pointId);
  if (!committed) {
    return { kind: 'stay', points: nextPoints, pointId: input.commit.pointId, inputStatus: 'invalid' };
  }
  const inputStatus = resolveGuidedTrialPointInputStatus(committed);
  if (!shouldAdvanceGuidedTrialOnCommit(input.commit.source) || inputStatus !== 'ok') {
    return { kind: 'stay', points: nextPoints, pointId: input.commit.pointId, inputStatus };
  }
  const nextPointId = findNextGuidedTrialPointIdAfter(nextPoints, input.commit.pointId);
  if (!nextPointId) {
    return { kind: 'advance', points: nextPoints, pointId: input.commit.pointId, next: null };
  }
  return {
    kind: 'advance',
    points: nextPoints,
    pointId: input.commit.pointId,
    next: createGuidedTrialFocusTarget(nextPointId, input.nextFocusRequestId)
  };
}

export function fingerprintGuidedTrialPoints(points: InspectionDrawingPoint[]): string {
  return points.map((p) => `${p.id}:${p.markerNo}`).join('|');
}
