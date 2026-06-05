import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingPointSidebar } from '../InspectionDrawingPointSidebar';

import type { InspectionDrawingPoint } from '../types';

const point: InspectionDrawingPoint = {
  id: 'pt-1',
  name: '穴径',
  markerNo: 1,
  xRatio: 0.4,
  yRatio: 0.6,
  nominalRaw: '10',
  upperToleranceRaw: '0.05',
  lowerToleranceRaw: '-0.05',
  testValue: '',
  decimalPlaces: 3
};

const baseProps = {
  points: [point],
  selectedPoint: point,
  contentReadOnly: false,
  onSelectPoint: vi.fn(),
  onPointChange: vi.fn(),
  onTestValueChange: vi.fn()
};

describe('InspectionDrawingPointSidebar', () => {
  it('shows settings panel only in place mode with a selected point', () => {
    render(<InspectionDrawingPointSidebar {...baseProps} mode="place" />);

    expect(screen.getByRole('group', { name: '測定点の位置調整' })).toBeInTheDocument();
  });

  it('hides settings panel in test mode', () => {
    render(<InspectionDrawingPointSidebar {...baseProps} mode="test" />);

    expect(screen.queryByRole('group', { name: '測定点の位置調整' })).not.toBeInTheDocument();
  });

  it('hides settings panel in guidedTrial mode', () => {
    render(<InspectionDrawingPointSidebar {...baseProps} mode="guidedTrial" />);

    expect(screen.queryByRole('group', { name: '測定点の位置調整' })).not.toBeInTheDocument();
  });
});
