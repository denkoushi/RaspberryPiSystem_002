import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InspectionDrawingValuePanel } from '../InspectionDrawingValuePanel';

import type { InspectionDrawingPoint } from '../types';

function makePoint(overrides: Partial<InspectionDrawingPoint> = {}): InspectionDrawingPoint {
  return {
    id: 'p1',
    markerNo: 1,
    name: '外径',
    xRatio: 0.5,
    yRatio: 0.5,
    nominalRaw: '10',
    lowerToleranceRaw: '-0.1',
    upperToleranceRaw: '0.1',
    testValue: '',
    ...overrides
  };
}

describe('InspectionDrawingValuePanel', () => {
  it('uses enlarged tolerance text and horizontal inputs for self_inspection_options with dropdown', () => {
    const { container } = render(
      <InspectionDrawingValuePanel
        point={makePoint()}
        valueInputMode="self_inspection_options"
        onValueChange={() => undefined}
      />
    );

    const tolerance = container.querySelector('.text-2xl');
    expect(tolerance).toBeTruthy();
    expect(tolerance?.textContent).toContain('基準 10');

    expect(screen.getByText('候補から選択')).toBeInTheDocument();
    expect(screen.getByText('測定値（直接入力）')).toBeInTheDocument();
    expect(container.querySelector('.grid.grid-cols-2')).toBeTruthy();
  });

  it('shows invalid status via shared measurement point input status helper', () => {
    render(
      <InspectionDrawingValuePanel
        point={makePoint({ testValue: 'abc' })}
        valueInputMode="self_inspection_options"
        onValueChange={() => undefined}
      />
    );

    expect(screen.getByText('不正')).toBeInTheDocument();
  });

  it('keeps vertical layout for free_only mode', () => {
    const { container } = render(
      <InspectionDrawingValuePanel
        point={makePoint()}
        valueInputMode="free_only"
        onValueChange={() => undefined}
      />
    );

    expect(container.querySelector('.text-2xl')).toBeNull();
    expect(container.querySelector('.grid.grid-cols-2')).toBeNull();
    expect(screen.getByText('測定値')).toBeInTheDocument();
  });
});
