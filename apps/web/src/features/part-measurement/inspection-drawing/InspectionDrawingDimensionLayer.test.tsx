import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { InspectionDrawingDimensionLayer } from './InspectionDrawingDimensionLayer';

import type { InspectionDrawingPoint } from './types';

const point: InspectionDrawingPoint = {
  id: 'p', name: '穴径', markerNo: 1, xRatio: 0.5, yRatio: 0.5,
  nominalRaw: '', upperToleranceRaw: '', lowerToleranceRaw: '', testValue: '',
  calloutTipXRatio: 0.8, calloutTipYRatio: 0.7,
  calloutDims: [{ dir: 'x', baseXRatio: 0.1, baseYRatio: 0.2, offsetRatio: 0.05 }]
};
const image = { width: 800, height: 600, offsetX: 0, offsetY: 0 };

class TestPointerEvent extends MouseEvent {
  readonly pointerId = 1;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(['read-only', 'unselected', 'unmount'])(
  'restores a dimension and cancels pending animation when %s interrupts dragging', (interruption) => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((next: FrameRequestCallback) => { callback = next; return 42; }));
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const onChange = vi.fn();
    const props = { points: [point], selectedPointId: point.id, image, width: 800, height: 600, editable: true, onChange };
    const { rerender, unmount } = render(<InspectionDrawingDimensionLayer {...props} />);
    const svg = screen.getByLabelText('寸法線');
    const getRect = vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect);
    const handle = screen.getByLabelText('X寸法基準点');
    const lines = [...svg.querySelectorAll('line')];
    const coordinates = () => lines.map((line) => ['x1', 'y1', 'x2', 'y2'].map((name) => line.getAttribute(name)));
    const original = coordinates();
    fireEvent.pointerDown(handle, { button: 0, clientX: 90, clientY: 130 });
    fireEvent.pointerMove(handle, { clientX: 95, clientY: 135 });
    callback?.(0);
    expect(handle).toHaveAttribute('cx', '85');
    expect(handle).toHaveAttribute('cy', '125');
    expect(coordinates()).not.toEqual(original);
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 140 });
    if (interruption === 'unmount') unmount();
    else rerender(<InspectionDrawingDimensionLayer {...props}
      editable={interruption !== 'read-only'} selectedPointId={interruption === 'unselected' ? null : point.id} />);
    expect(cancel).toHaveBeenCalledWith(42);
    expect(coordinates()).toEqual(original);
    expect(getRect).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 140 });
    expect(onChange).not.toHaveBeenCalled();
    if (interruption !== 'unmount') expect(svg).not.toHaveClass('z-20');
  }
);
