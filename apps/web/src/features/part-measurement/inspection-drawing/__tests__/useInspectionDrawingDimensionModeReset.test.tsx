import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { useInspectionDrawingDimensionModeReset } from '../useInspectionDrawingDimensionModeReset';

import type { InspectionDrawingToolbarMode } from '../InspectionDrawingCreateToolbar';

type Point = { calloutTipXRatio?: number | null; calloutTipYRatio?: number | null } | null;

const withTip: Point = { calloutTipXRatio: 0.4, calloutTipYRatio: 0.6 };
const withoutTip: Point = { calloutTipXRatio: null, calloutTipYRatio: null };

function setup(initialMode: InspectionDrawingToolbarMode, initialPoint: Point) {
  return renderHook(
    ({ point }: { point: Point }) => {
      const [mode, setMode] = useState<InspectionDrawingToolbarMode>(initialMode);
      useInspectionDrawingDimensionModeReset(mode, setMode, point);
      return { mode, setMode };
    },
    { initialProps: { point: initialPoint } }
  );
}

describe('useInspectionDrawingDimensionModeReset', () => {
  it.each(['dimX', 'dimY'] as const)('keeps %s while the selected point has a callout tip', (mode) => {
    const { result } = setup(mode, withTip);
    expect(result.current.mode).toBe(mode);
  });

  it.each(['dimX', 'dimY'] as const)('returns %s to place when no point is selected', (mode) => {
    const { result } = setup(mode, null);
    expect(result.current.mode).toBe('place');
  });

  it('returns to place when the selected point loses its callout tip', () => {
    const { result, rerender } = setup('dimX', withTip);
    expect(result.current.mode).toBe('dimX');
    rerender({ point: withoutTip });
    expect(result.current.mode).toBe('place');
  });

  it('returns to place when switching into a dimension mode without a callout tip', () => {
    const { result } = setup('place', withoutTip);
    act(() => result.current.setMode('dimY'));
    expect(result.current.mode).toBe('place');
  });

  it.each(['place', 'callout', 'test', 'guidedTrial'] as const)('leaves %s untouched without a callout tip', (mode) => {
    const { result } = setup(mode, null);
    expect(result.current.mode).toBe(mode);
  });
});
