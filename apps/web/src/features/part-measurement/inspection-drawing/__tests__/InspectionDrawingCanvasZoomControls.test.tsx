import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingCanvasZoomControls } from '../InspectionDrawingCanvasZoomControls';

describe('InspectionDrawingCanvasZoomControls', () => {
  it('renders reset zoom between zoom out and zoom in when provided', () => {
    const onZoomOut = vi.fn();
    const onResetZoom = vi.fn();
    const onZoomIn = vi.fn();
    const onFitToView = vi.fn();

    render(
      <InspectionDrawingCanvasZoomControls
        enabled
        onZoomOut={onZoomOut}
        onResetZoom={onResetZoom}
        onZoomIn={onZoomIn}
        onFitToView={onFitToView}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['−', '100%', '＋', '□']);

    fireEvent.click(screen.getByRole('button', { name: '元サイズ' }));

    expect(onResetZoom).toHaveBeenCalledTimes(1);
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onFitToView).not.toHaveBeenCalled();
  });

  it('keeps the previous three-button control when reset zoom is omitted', () => {
    render(
      <InspectionDrawingCanvasZoomControls
        enabled
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitToView={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '元サイズ' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['−', '＋', '□']);
  });
});
