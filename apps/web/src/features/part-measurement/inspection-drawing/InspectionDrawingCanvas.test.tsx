import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionDrawingCanvas } from './InspectionDrawingCanvas';
import {
  INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX
} from './inspectionDrawingCanvasPointer';

import type { InspectionDrawingPoint } from './types';

const point: InspectionDrawingPoint = {
  id: 'point-1',
  name: '穴径',
  markerNo: 1,
  xRatio: 0.25,
  yRatio: 0.25,
  nominalRaw: '10',
  upperToleranceRaw: '0.1',
  lowerToleranceRaw: '-0.1',
  testValue: ''
};

const viewportRect = {
  x: 10,
  y: 20,
  width: 800,
  height: 600,
  top: 20,
  right: 810,
  bottom: 620,
  left: 10,
  toJSON: () => ({})
} as DOMRect;

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
const originalSetPointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'setPointerCapture'
);
const originalHasPointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'hasPointerCapture'
);
const originalReleasePointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'releasePointerCapture'
);

const capturedPointers = new WeakMap<HTMLElement, Set<number>>();
const rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 1;
let requestAnimationFrameMock: ReturnType<typeof vi.fn>;

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

function flushAnimationFrames() {
  const callbacks = [...rafCallbacks.entries()];
  rafCallbacks.clear();
  for (const [, callback] of callbacks) callback(performance.now());
}

function setViewportGeometry(viewport: HTMLElement, zoom: number) {
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, writable: true, value: zoom > 1 ? 200 : 0 });
  Object.defineProperty(viewport, 'scrollTop', { configurable: true, writable: true, value: zoom > 1 ? 100 : 0 });
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(viewportRect);
}

function renderCanvas({
  mode = 'place' as const,
  zoom = 1,
  onAddPoint = vi.fn(),
  onPointChange = vi.fn(),
  onSetCalloutTip = vi.fn(),
  withPointChange = true
}: {
  mode?: 'place' | 'callout' | 'test';
  zoom?: number;
  onAddPoint?: ReturnType<typeof vi.fn>;
  onPointChange?: ReturnType<typeof vi.fn>;
  onSetCalloutTip?: ReturnType<typeof vi.fn>;
  withPointChange?: boolean;
} = {}) {
  render(
    <InspectionDrawingCanvas
      imageUrl="/drawing.svg"
      points={[point]}
      mode={mode}
      zoom={zoom}
      selectedPointId={null}
      onSelectPoint={vi.fn()}
      onAddPoint={onAddPoint}
      onPointChange={withPointChange ? onPointChange : undefined}
      onSetCalloutTip={onSetCalloutTip}
    />
  );

  const viewport = screen.getByRole('presentation');
  setViewportGeometry(viewport, zoom);
  const image = viewport.querySelector('img');
  if (!(image instanceof HTMLImageElement)) throw new Error('canvas image was not rendered');
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 1600 },
    naturalHeight: { configurable: true, value: 1200 }
  });
  fireEvent.load(image);
  flushAnimationFrames();

  return {
    viewport,
    marker: screen.getByRole('button', { name: '穴径' }),
    markerShell: screen.getByRole('button', { name: '穴径' }).parentElement as HTMLDivElement,
    onAddPoint,
    onPointChange,
    onSetCalloutTip
  };
}

describe('InspectionDrawingCanvas marker dragging', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions | number, y?: number) {
        if (typeof options === 'number') {
          this.scrollLeft = options;
          this.scrollTop = y ?? 0;
          return;
        }
        this.scrollLeft = options.left ?? this.scrollLeft;
        this.scrollTop = options.top ?? this.scrollTop;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        const ids = capturedPointers.get(this) ?? new Set<number>();
        ids.add(pointerId);
        capturedPointers.set(this, ids);
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        return capturedPointers.get(this)?.has(pointerId) ?? false;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        capturedPointers.get(this)?.delete(pointerId);
      }
    });
  });

  beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    rafCallbacks.clear();
    nextRafId = 1;
    requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: requestAnimationFrameMock
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: vi.fn((id: number) => rafCallbacks.delete(id))
    });
  });

  afterEach(() => {
    rafCallbacks.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    if (originalSetPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture);
    } else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    if (originalHasPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', originalHasPointerCapture);
    } else Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
    if (originalReleasePointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', originalReleasePointerCapture);
    } else Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
  });

  it('keeps a normal marker click as selection without changing its position', () => {
    const onSelectPoint = vi.fn();
    render(
      <InspectionDrawingCanvas
        imageUrl="/drawing.svg"
        points={[point]}
        mode="place"
        selectedPointId={null}
        onSelectPoint={onSelectPoint}
        onPointChange={vi.fn()}
      />
    );
    const viewport = screen.getByRole('presentation');
    setViewportGeometry(viewport, 1);
    const image = viewport.querySelector('img') as HTMLImageElement;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1600 },
      naturalHeight: { configurable: true, value: 1200 }
    });
    fireEvent.load(image);
    flushAnimationFrames();
    const marker = screen.getByRole('button', { name: '穴径' });
    fireEvent.pointerDown(marker, { pointerId: 1, button: 0, clientX: 210, clientY: 170 });
    fireEvent.pointerUp(viewport, { pointerId: 1, button: 0, clientX: 210, clientY: 170 });

    expect(onSelectPoint).toHaveBeenCalledTimes(1);
    expect(onSelectPoint).toHaveBeenCalledWith('point-1');
    expect(marker.parentElement).toHaveStyle({ left: '200px', top: '150px' });
  });

  it('updates the marker through one rAF per move and commits one clamped patch on pointerup', () => {
    const onPointChange = vi.fn();
    const { viewport, marker, markerShell } = renderCanvas({
      zoom: 2,
      onPointChange
    });
    const baselineRafCalls = requestAnimationFrameMock.mock.calls.length;

    fireEvent.pointerDown(marker, { pointerId: 2, button: 0, clientX: 210, clientY: 220 });
    expect(capturedPointers.get(viewport)?.has(2)).toBe(true);
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 650, clientY: 500 });

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(baselineRafCalls + 1);
    expect(markerShell).toHaveStyle({ left: '400px', top: '300px' });
    expect(onPointChange).not.toHaveBeenCalled();

    flushAnimationFrames();
    expect(markerShell).toHaveStyle({ left: '840px', top: '580px' });

    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: -1000, clientY: 2100 });
    fireEvent.pointerUp(viewport, { pointerId: 2, clientX: -1000, clientY: 2100 });

    expect(onPointChange).toHaveBeenCalledTimes(1);
    expect(onPointChange).toHaveBeenCalledWith('point-1', { xRatio: 0, yRatio: 1 });
    expect(markerShell).toHaveStyle({ left: '0px', top: '1200px' });
    expect(capturedPointers.get(viewport)?.has(2)).toBe(false);
  });

  it('does not start dragging below the shared pointer movement threshold', () => {
    const onPointChange = vi.fn();
    const { viewport, marker } = renderCanvas({ onPointChange });

    fireEvent.pointerDown(marker, { pointerId: 3, button: 0, clientX: 210, clientY: 170 });
    fireEvent.pointerMove(viewport, {
      pointerId: 3,
      clientX: 210 + INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX - 1,
      clientY: 170
    });
    fireEvent.pointerUp(viewport, {
      pointerId: 3,
      clientX: 210 + INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX - 1,
      clientY: 170
    });

    expect(onPointChange).not.toHaveBeenCalled();
  });

  it('restores the original marker style on pointercancel without committing', () => {
    const onPointChange = vi.fn();
    const { viewport, marker, markerShell } = renderCanvas({ onPointChange });
    const originalStyle = { left: markerShell.style.left, top: markerShell.style.top };

    fireEvent.pointerDown(marker, { pointerId: 4, button: 0, clientX: 210, clientY: 170 });
    fireEvent.pointerMove(viewport, { pointerId: 4, clientX: 500, clientY: 420 });
    flushAnimationFrames();
    expect(markerShell.style.left).not.toBe(originalStyle.left);

    fireEvent.pointerCancel(viewport, { pointerId: 4, clientX: 500, clientY: 420 });

    expect(markerShell).toHaveStyle(originalStyle);
    expect(onPointChange).not.toHaveBeenCalled();
    expect(capturedPointers.get(viewport)?.has(4)).toBe(false);
  });

  it.each([
    { mode: 'test' as const, withPointChange: true },
    { mode: 'place' as const, withPointChange: false }
  ])('disables marker dragging in $mode/read-only canvas', ({ mode, withPointChange }) => {
    const onPointChange = vi.fn();
    const { viewport, marker } = renderCanvas({ mode, withPointChange, onPointChange });

    fireEvent.pointerDown(marker, { pointerId: 5, button: 0, clientX: 210, clientY: 170 });
    fireEvent.pointerMove(viewport, { pointerId: 5, clientX: 500, clientY: 420 });
    fireEvent.pointerUp(viewport, { pointerId: 5, clientX: 500, clientY: 420 });

    expect(onPointChange).not.toHaveBeenCalled();
  });

  it('preserves background placement and callout tip actions', () => {
    const onAddPoint = vi.fn();
    const onSetCalloutTip = vi.fn();
    const { viewport: placeViewport } = renderCanvas({ onAddPoint });
    fireEvent.pointerDown(placeViewport, { pointerId: 6, button: 0, clientX: 410, clientY: 320 });
    fireEvent.pointerUp(placeViewport, { pointerId: 6, button: 0, clientX: 410, clientY: 320 });
    expect(onAddPoint).toHaveBeenCalledTimes(1);

    cleanup();
    const onCalloutPointChange = vi.fn();
    const { viewport: calloutViewport } = renderCanvas({
      mode: 'callout',
      onSetCalloutTip,
      onPointChange: onCalloutPointChange
    });
    fireEvent.pointerDown(calloutViewport, { pointerId: 7, button: 0, clientX: 410, clientY: 320 });
    fireEvent.pointerUp(calloutViewport, { pointerId: 7, button: 0, clientX: 410, clientY: 320 });
    expect(onSetCalloutTip).toHaveBeenCalledTimes(1);
    expect(onSetCalloutTip).toHaveBeenCalledWith(0.5, 0.5);

    const calloutMarker = screen.getByRole('button', { name: '穴径' });
    fireEvent.pointerDown(calloutMarker, { pointerId: 8, button: 0, clientX: 210, clientY: 170 });
    fireEvent.pointerMove(calloutViewport, { pointerId: 8, clientX: 500, clientY: 420 });
    fireEvent.pointerUp(calloutViewport, { pointerId: 8, clientX: 500, clientY: 420 });
    expect(onCalloutPointChange).toHaveBeenCalledTimes(1);
    expect(onCalloutPointChange).toHaveBeenCalledWith('point-1', {
      xRatio: expect.closeTo(0.6125),
      yRatio: expect.closeTo(2 / 3)
    });
  });
});
