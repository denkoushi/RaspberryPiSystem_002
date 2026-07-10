import { fireEvent, render, screen } from '@testing-library/react';
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
  onTestValueChange: vi.fn(),
  onModeChange: vi.fn(),
  hasDrawingImage: true,
  hasMeasurementPoints: true
};

describe('InspectionDrawingPointSidebar', () => {
  it('shows settings panel and mode row in place mode with a selected point', () => {
    render(<InspectionDrawingPointSidebar {...baseProps} mode="place" />);

    expect(screen.getByRole('group', { name: '測定点の位置調整' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '丸数字' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '矢視' })).toBeInTheDocument();
    expect(screen.getByText('矢視 なし')).toBeInTheDocument();
  });

  it('keeps mode row when no point is selected so place/callout can switch', () => {
    const onModeChange = vi.fn();
    render(
      <InspectionDrawingPointSidebar
        {...baseProps}
        mode="callout"
        selectedPoint={null}
        onModeChange={onModeChange}
      />
    );

    expect(screen.queryByRole('group', { name: '測定点の位置調整' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '丸数字' })).toBeInTheDocument();
    expect(screen.getByText(/矢視の先端をタップ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '丸数字' }));
    expect(onModeChange).toHaveBeenCalledWith('place');
  });

  it('hides settings panel in test mode', () => {
    render(<InspectionDrawingPointSidebar {...baseProps} mode="test" />);

    expect(screen.queryByRole('group', { name: '測定点の位置調整' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '丸数字' })).not.toBeInTheDocument();
  });
});
