import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  createInspectionDrawingCalloutDimsChangeHandler,
  useInspectionDrawingDimensionModeReset
} from '../useInspectionDrawingDimensionModeReset';

import type { InspectionDrawingToolbarMode } from '../InspectionDrawingCreateToolbar';
import type { InspectionDrawingCalloutDim, InspectionDrawingPoint } from '../types';

type Point = Pick<InspectionDrawingPoint, 'calloutTipXRatio' | 'calloutTipYRatio'> | null;

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

describe('createInspectionDrawingCalloutDimsChangeHandler', () => {
  const dims: InspectionDrawingCalloutDim[] = [{ dir: 'x', baseXRatio: 0.5, baseYRatio: 0.5, offsetRatio: 0.1 }];

  const both: InspectionDrawingCalloutDim[] = [...dims, { dir: 'y', baseXRatio: 0.5, baseYRatio: 0.5, offsetRatio: 0.9 }];

  it.each([
    ['dimX', dims, 'dimY'],
    ['dimY', [both[1]], 'dimX'],
    ['dimX', both, 'place'],
    ['dimY', both, 'place']
  ] as const)('saves the dims in %s and moves on to the next mode', (mode, next, expected) => {
    const setMode = vi.fn();
    const updatePoint = vi.fn();
    createInspectionDrawingCalloutDimsChangeHandler(mode, setMode, updatePoint)('p1', [...next]);
    expect(updatePoint).toHaveBeenCalledWith('p1', { calloutDims: [...next] });
    expect(setMode).toHaveBeenCalledWith(expected);
  });

  it.each(['place', 'callout'] as const)('saves the dims and keeps %s', (mode) => {
    const setMode = vi.fn();
    const updatePoint = vi.fn();
    createInspectionDrawingCalloutDimsChangeHandler(mode, setMode, updatePoint)('p1', dims);
    expect(updatePoint).toHaveBeenCalledWith('p1', { calloutDims: dims });
    expect(setMode).not.toHaveBeenCalled();
  });
});
