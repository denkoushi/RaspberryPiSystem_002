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
