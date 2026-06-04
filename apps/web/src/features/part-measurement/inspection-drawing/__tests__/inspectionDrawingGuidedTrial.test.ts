import { describe, expect, it } from 'vitest';

import {
  applyGuidedTrialValue,
  resolveGuidedTrialInitialTarget,
  resolveGuidedTrialResumeTarget,
  sortGuidedTrialPointsStable
} from '../inspectionDrawingGuidedTrial';
import { createInspectionDrawingPoint } from '../markerNumbering';

import type { InspectionDrawingPoint } from '../types';

function point(markerNo: number, testValue: string, id?: string): InspectionDrawingPoint {
  const base = createInspectionDrawingPoint(0.2, 0.3, markerNo);
  return {
    ...base,
    id: id ?? `p-${markerNo}`,
    testValue,
    name: `No.${markerNo}`,
    legacyAbsoluteBounds: { lowerLimit: 9.8, upperLimit: 10.2 }
  };
}

describe('inspectionDrawingGuidedTrial', () => {
  it('sorts by markerNo then array index', () => {
    const points = [point(2, '', 'b'), point(1, '', 'a'), point(1, '', 'c')];
    const sorted = sortGuidedTrialPointsStable(points);
    expect(sorted.map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  it('starts at minimum pending marker', () => {
    const points = [point(1, '10.0'), point(2, '')];
    const target = resolveGuidedTrialInitialTarget(points, 1);
    expect(target?.pointId).toBe(points[1]!.id);
  });

  it('advances only on OK commit', () => {
    const points = [point(1, ''), point(2, '')];
    const stay = applyGuidedTrialValue({
      points,
      commit: { pointId: points[0]!.id, value: '10.5', source: 'enter' },
      nextFocusRequestId: 2
    });
    expect(stay.kind).toBe('stay');

    const advance = applyGuidedTrialValue({
      points,
      commit: { pointId: points[0]!.id, value: '10.0', source: 'enter' },
      nextFocusRequestId: 2
    });
    expect(advance.kind).toBe('advance');
    if (advance.kind === 'advance') {
      expect(advance.next?.pointId).toBe(points[1]!.id);
    }
  });

  it('resume returns minimum pending marker', () => {
    const points = [point(1, '10.0'), point(2, ''), point(3, '')];
    const target = resolveGuidedTrialResumeTarget(points, 3);
    expect(target?.pointId).toBe(points[1]!.id);
  });
});
