import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverlayRangeSelectionSurface } from './OverlayRangeSelectionSurface';

describe('OverlayRangeSelectionSurface assembly contract', () => {
  beforeEach(() => vi.stubGlobal('PointerEvent', MouseEvent));
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function surface() {
    const element = screen.getByRole('application', { name: 'オーバーレイ範囲選択面' });
    element.setPointerCapture = vi.fn();
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    return element;
  }
  it('retains assembly DOM hooks, pointer capture and the preview appearance', () => {
    const onRangeSelected = vi.fn();
    render(<OverlayRangeSelectionSurface selectionMode pageIndex={2} onRangeSelected={onRangeSelected} />);
    const element = surface();
    expect(element).toHaveAttribute('data-kiosk-sop-target', 'assembly-document-editor-range-surface');
    expect(element).toHaveAttribute('data-page-index', '2');
    expect(element).toHaveClass('absolute', 'inset-0', 'z-40', 'touch-none');
    fireEvent.pointerDown(element, { button: 0, clientX: 60, clientY: 60 });
    expect(element.setPointerCapture).toHaveBeenCalledOnce();
    fireEvent.pointerMove(element, { clientX: 10, clientY: 20 });
    expect(screen.getByTestId('assembly-document-editor-pending-range')).toHaveClass('border-amber-300', 'bg-amber-300/20');
    fireEvent.pointerUp(element, { clientX: 10, clientY: 20 });
    expect(onRangeSelected).toHaveBeenCalledWith({ xRatio: 0.1, yRatio: 0.2, widthRatio: 0.5, heightRatio: expect.closeTo(0.4) });
    expect(screen.queryByTestId('assembly-document-editor-pending-range')).not.toBeInTheDocument();
  });
  it('projects crop coordinates and ignores rectangles narrower than one percent', () => {
    const onRangeSelected = vi.fn();
    render(<OverlayRangeSelectionSurface selectionMode pageIndex={0} crop={{ xRatio: 0.2, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.5 }} onRangeSelected={onRangeSelected} />);
    const element = surface();
    fireEvent.pointerDown(element, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(element, { clientX: 0.5, clientY: 50 });
    expect(onRangeSelected).not.toHaveBeenCalled();
    fireEvent.pointerDown(element, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerCancel(element, { clientX: 50, clientY: 50 });
    expect(onRangeSelected).toHaveBeenCalledWith({ xRatio: 0.2, yRatio: 0.1, widthRatio: 0.25, heightRatio: 0.25 });
  });
  it('renders nothing outside selection mode', () => {
    render(<OverlayRangeSelectionSurface selectionMode={false} pageIndex={0} onRangeSelected={vi.fn()} />);
    expect(screen.queryByRole('application')).not.toBeInTheDocument();
  });
});
