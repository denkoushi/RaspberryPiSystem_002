import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingPlaceCalloutModeRow } from '../InspectionDrawingPlaceCalloutModeRow';

describe('InspectionDrawingPlaceCalloutModeRow', () => {
  it('shows 丸数字 / 矢視 and toggles place mode', () => {
    const onModeChange = vi.fn();
    render(
      <InspectionDrawingPlaceCalloutModeRow
        mode="callout"
        onModeChange={onModeChange}
        hasDrawingImage
        hasMeasurementPoints
      />
    );

    expect(screen.getByRole('button', { name: '丸数字' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '矢視' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '丸数字' }));
    expect(onModeChange).toHaveBeenCalledWith('place');
  });

  it('disables 矢視 when there are no measurement points', () => {
    render(
      <InspectionDrawingPlaceCalloutModeRow
        mode="place"
        onModeChange={vi.fn()}
        hasDrawingImage
        hasMeasurementPoints={false}
      />
    );
    expect(screen.getByRole('button', { name: '矢視' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '丸数字' })).toBeEnabled();
  });

  it('shows callout status and clears tip', () => {
    const onClear = vi.fn();
    render(
      <InspectionDrawingPlaceCalloutModeRow
        mode="callout"
        onModeChange={vi.fn()}
        hasDrawingImage
        hasMeasurementPoints
        calloutStatus={{ hasCallout: true, onClear }}
      />
    );

    expect(screen.getByText('矢視 あり')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('dimension controls', () => {
  it.each([['x', '矢視・寸法X'], ['y', '矢視・寸法Y'], ['xy', '矢視・寸法XY']])('shows %s status without truncation', (dirs, status) => {
    render(<InspectionDrawingPlaceCalloutModeRow mode="place" onModeChange={vi.fn()} hasDrawingImage hasMeasurementPoints
      calloutStatus={{ hasCallout: true, onClear: vi.fn(), dims: [...dirs].map((dir) => ({ dir: dir as 'x' | 'y' })) }} />);
    expect(screen.getByText(status)).toHaveClass('whitespace-nowrap');
    expect(screen.getByTestId('inspection-drawing-place-callout-mode-row')).toHaveClass('flex-wrap');
    expect(screen.getByRole('button', { name: '寸法' })).toBeEnabled();
  });
  it('disables dimensions without a callout', () => {
    render(<InspectionDrawingPlaceCalloutModeRow mode="place" onModeChange={vi.fn()} hasDrawingImage hasMeasurementPoints
      calloutStatus={{ hasCallout: false, onClear: vi.fn() }} />);
    expect(screen.getByRole('button', { name: '寸法' })).toBeDisabled();
    expect(screen.getByText('矢視 なし')).toBeInTheDocument();
  });
  it('opens dimension mode and selects X or Y inline', () => {
    const onModeChange = vi.fn();
    const props = { onModeChange, hasDrawingImage: true, hasMeasurementPoints: true,
      calloutStatus: { hasCallout: true, onClear: vi.fn() } };
    const { rerender } = render(<InspectionDrawingPlaceCalloutModeRow {...props} mode="place" />);
    fireEvent.click(screen.getByRole('button', { name: '寸法' }));
    expect(onModeChange).toHaveBeenLastCalledWith('dimX');
    rerender(<InspectionDrawingPlaceCalloutModeRow {...props} mode="dimX" />);
    expect(screen.getByRole('button', { name: 'X' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Y' }));
    expect(onModeChange).toHaveBeenLastCalledWith('dimY');
  });
  it.each([['x', 'dimY'], ['y', 'dimX'], ['xy', 'dimX']])('opens the missing direction first when %s is placed', (dirs, expected) => {
    const onModeChange = vi.fn();
    render(<InspectionDrawingPlaceCalloutModeRow mode="place" onModeChange={onModeChange} hasDrawingImage hasMeasurementPoints
      calloutStatus={{ hasCallout: true, onClear: vi.fn(), dims: [...dirs].map((dir) => ({ dir: dir as 'x' | 'y' })) }} />);
    fireEvent.click(screen.getByRole('button', { name: '寸法' }));
    expect(onModeChange).toHaveBeenLastCalledWith(expected);
  });
});
