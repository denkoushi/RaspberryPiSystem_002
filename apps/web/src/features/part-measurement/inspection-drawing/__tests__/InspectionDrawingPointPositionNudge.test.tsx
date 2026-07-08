import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO } from '../inspectionDrawingPointPosition';
import { InspectionDrawingPointPositionNudge } from '../InspectionDrawingPointPositionNudge';

import type { InspectionDrawingPoint } from '../types';

const point: InspectionDrawingPoint = {
  id: 'pt-1',
  name: '穴径',
  markerNo: 1,
  xRatio: 0.5,
  yRatio: 0.5,
  nominalRaw: '10',
  upperToleranceRaw: '0.05',
  lowerToleranceRaw: '-0.05',
  testValue: '',
  decimalPlaces: 3
};

describe('InspectionDrawingPointPositionNudge', () => {
  it('exposes aria-label on direction buttons', () => {
    render(<InspectionDrawingPointPositionNudge point={point} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '上へ移動' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下へ移動' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '左へ移動' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '右へ移動' })).toBeInTheDocument();
  });

  it('renders direction buttons in one row order', () => {
    render(<InspectionDrawingPointPositionNudge point={point} onChange={vi.fn()} />);

    expect(
      screen.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['↑', '↓', '←', '→']);
    expect(screen.queryByText('位置')).not.toBeInTheDocument();
  });

  it('calls onChange with clamped coordinate patch when a direction is pressed', () => {
    const onChange = vi.fn();

    render(
      <InspectionDrawingPointPositionNudge
        point={point}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '右へ移動' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      xRatio: 0.5 + INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO,
      yRatio: 0.5
    });
  });

  it('disables direction buttons when disabled', () => {
    render(
      <InspectionDrawingPointPositionNudge point={point} disabled onChange={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: '右へ移動' })).toBeDisabled();
  });
});
