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
});

describe('dimension controls', () => {
  it.each(['', 'x', 'y', 'xy'])('shows only the placed callout and dimension chips (%s)', (dirs) => {
    const onRemove = vi.fn();
    render(<InspectionDrawingPlaceCalloutModeRow mode="place" onModeChange={vi.fn()} hasDrawingImage hasMeasurementPoints
      calloutStatus={{ hasCallout: true, onRemove, dims: [...dirs].map((dir) => ({ dir: dir as 'x' | 'y' })) }} />);
    const chips = screen.getAllByRole('button', { name: /を削除$/ });
    expect(chips.map((chip) => chip.textContent)).toEqual(['矢視', ...dirs.toUpperCase()]);
    chips.forEach((chip) => fireEvent.click(chip));
    expect(onRemove.mock.calls).toEqual(['tip', ...dirs].map((target) => [target]));
    expect(screen.getByRole('button', { name: '寸法' })).toBeEnabled();
  });
  it('disables dimensions without a callout', () => {
    render(<InspectionDrawingPlaceCalloutModeRow mode="place" onModeChange={vi.fn()} hasDrawingImage hasMeasurementPoints
      calloutStatus={{ hasCallout: false, onRemove: vi.fn() }} />);
    expect(screen.getByRole('button', { name: '寸法' })).toBeDisabled();
    expect(screen.getByText('矢視 なし')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /を削除$/ })).not.toBeInTheDocument();
  });
  it('opens dimension mode and puts the direction toggles before the chips', () => {
    const onModeChange = vi.fn();
    const props = { onModeChange, hasDrawingImage: true, hasMeasurementPoints: true,
      calloutStatus: { hasCallout: true, onRemove: vi.fn() } };
    const { rerender } = render(<InspectionDrawingPlaceCalloutModeRow {...props} mode="place" />);
    fireEvent.click(screen.getByRole('button', { name: '寸法' }));
    expect(onModeChange).toHaveBeenLastCalledWith('dimX');
    rerender(<InspectionDrawingPlaceCalloutModeRow {...props} mode="dimX" />);
    expect(screen.getByRole('button', { name: 'X' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['丸数字', '矢視', '寸法', 'X', 'Y', '矢視']);
    fireEvent.click(screen.getByRole('button', { name: 'Y' }));
    expect(onModeChange).toHaveBeenLastCalledWith('dimY');
  });
  it('disables all removal chips when the content is read-only', () => {
    const onRemove = vi.fn();
    render(<InspectionDrawingPlaceCalloutModeRow mode="dimY" onModeChange={vi.fn()} hasDrawingImage hasMeasurementPoints
      calloutStatus={{ hasCallout: true, onRemove, disabled: true, dims: [{ dir: 'x' }, { dir: 'y' }] }} />);
    const chips = screen.getAllByRole('button', { name: /を削除$/ });
    expect(chips).toHaveLength(3);
    chips.forEach((chip) => {
      expect(chip).toBeDisabled();
      fireEvent.click(chip);
    });
    expect(onRemove).not.toHaveBeenCalled();
  });
  it.each([['x', 'dimY'], ['y', 'dimX'], ['xy', 'dimX']])('opens the missing direction first when %s is placed', (dirs, expected) => {
    const onModeChange = vi.fn();
    render(<InspectionDrawingPlaceCalloutModeRow mode="place" onModeChange={onModeChange} hasDrawingImage hasMeasurementPoints
      calloutStatus={{ hasCallout: true, onRemove: vi.fn(), dims: [...dirs].map((dir) => ({ dir: dir as 'x' | 'y' })) }} />);
    fireEvent.click(screen.getByRole('button', { name: '寸法' }));
    expect(onModeChange).toHaveBeenLastCalledWith(expected);
  });
});
