import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureMarkerLayer } from './AssemblyProcedureMarkerLayer';

const bolt = {
  id: 'bolt-1',
  markerNo: 1,
  xRatio: 0.4,
  yRatio: 0.5,
  calloutTipXRatio: 0.8,
  calloutTipYRatio: 0.2,
  label: '締付点1'
};

const checkItem = {
  id: 'check-1',
  markerNo: 1,
  xRatio: 0.2,
  yRatio: 0.3,
  label: 'チェック1',
  required: true,
  checked: false
};

const layerRect = {
  x: 10,
  y: 20,
  width: 400,
  height: 200,
  top: 20,
  right: 410,
  bottom: 220,
  left: 10,
  toJSON: () => ({})
} as DOMRect;

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
const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(
  window,
  'requestAnimationFrame'
);
const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(
  window,
  'cancelAnimationFrame'
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

function flushAnimationFrames(): void {
  const callbacks = [...rafCallbacks.entries()];
  rafCallbacks.clear();
  for (const [, callback] of callbacks) callback(performance.now());
}

describe('AssemblyProcedureMarkerLayer bolt dragging', () => {
  beforeAll(() => {
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
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(layerRect);
  });

  afterEach(() => {
    rafCallbacks.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (originalSetPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture);
    } else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    if (originalHasPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', originalHasPointerCapture);
    } else Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
    if (originalReleasePointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', originalReleasePointerCapture);
    } else Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
    if (originalRequestAnimationFrame) {
      Object.defineProperty(window, 'requestAnimationFrame', originalRequestAnimationFrame);
    } else Reflect.deleteProperty(window, 'requestAnimationFrame');
    if (originalCancelAnimationFrame) {
      Object.defineProperty(window, 'cancelAnimationFrame', originalCancelAnimationFrame);
    } else Reflect.deleteProperty(window, 'cancelAnimationFrame');
  });

  it('keeps normal click selection and disables drag affordance without a move handler', () => {
    const onSelectBolt = vi.fn();
    render(
      <div className="relative h-[200px] w-[400px]">
        <AssemblyProcedureMarkerLayer bolts={[bolt]} onSelectBolt={onSelectBolt} />
      </div>
    );

    const marker = screen.getByRole('button', { name: '締付点1' });
    fireEvent.pointerDown(marker, { button: 0, pointerId: 1, clientX: 170, clientY: 120 });
    fireEvent.pointerUp(marker, { pointerId: 1, clientX: 170, clientY: 120 });
    fireEvent.click(marker);

    expect(onSelectBolt).toHaveBeenCalledTimes(1);
    expect(marker).toHaveStyle({ left: '40%', top: '50%' });
    expect(marker).not.toHaveClass('touch-none', 'cursor-move');
  });

  it('captures a bolt, previews with one rAF, and commits one clamped position while preserving its tip', () => {
    const onMoveBolt = vi.fn();
    render(
      <div className="relative h-[200px] w-[400px]">
        <AssemblyProcedureMarkerLayer bolts={[bolt]} onMoveBolt={onMoveBolt} />
      </div>
    );

    const marker = screen.getByRole('button', { name: '締付点1' });
    fireEvent.pointerDown(marker, { button: 0, pointerId: 2, clientX: 170, clientY: 120 });
    expect(capturedPointers.get(marker)?.has(2)).toBe(true);
    fireEvent.pointerMove(marker, { pointerId: 2, clientX: 250, clientY: 130 });
    fireEvent.pointerMove(marker, { pointerId: 2, clientX: 700, clientY: -300 });

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(onMoveBolt).not.toHaveBeenCalled();
    expect(marker).toHaveStyle({ left: '40%', top: '50%' });

    flushAnimationFrames();
    expect(marker).toHaveStyle({ left: '100%', top: '0%' });
    expect(onMoveBolt).not.toHaveBeenCalled();

    fireEvent.pointerUp(marker, { pointerId: 2, clientX: 700, clientY: -300 });

    expect(onMoveBolt).toHaveBeenCalledTimes(1);
    expect(onMoveBolt).toHaveBeenCalledWith('bolt-1', { xRatio: 1, yRatio: 0 });
    expect(capturedPointers.get(marker)?.has(2)).toBe(false);
    expect(bolt).toMatchObject({
      calloutTipXRatio: 0.8,
      calloutTipYRatio: 0.2
    });
  });

  it('does not enter drag mode below the shared movement threshold', () => {
    const onMoveBolt = vi.fn();
    render(
      <div className="relative h-[200px] w-[400px]">
        <AssemblyProcedureMarkerLayer bolts={[bolt]} onMoveBolt={onMoveBolt} />
      </div>
    );

    const marker = screen.getByRole('button', { name: '締付点1' });
    fireEvent.pointerDown(marker, { button: 0, pointerId: 3, clientX: 170, clientY: 120 });
    fireEvent.pointerMove(marker, { pointerId: 3, clientX: 179, clientY: 120 });
    fireEvent.pointerUp(marker, { pointerId: 3, clientX: 179, clientY: 120 });

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    expect(onMoveBolt).not.toHaveBeenCalled();
    expect(marker).toHaveStyle({ left: '40%', top: '50%' });
  });

  it('restores the original style on pointercancel without committing', () => {
    const onMoveBolt = vi.fn();
    render(
      <div className="relative h-[200px] w-[400px]">
        <AssemblyProcedureMarkerLayer bolts={[bolt]} onMoveBolt={onMoveBolt} />
      </div>
    );

    const marker = screen.getByRole('button', { name: '締付点1' });
    fireEvent.pointerDown(marker, { button: 0, pointerId: 4, clientX: 170, clientY: 120 });
    fireEvent.pointerMove(marker, { pointerId: 4, clientX: 300, clientY: 150 });
    flushAnimationFrames();
    expect(marker).toHaveStyle({ left: '72.5%', top: '65%' });

    fireEvent.pointerCancel(marker, { pointerId: 4, clientX: 300, clientY: 150 });

    expect(marker).toHaveStyle({ left: '40%', top: '50%' });
    expect(onMoveBolt).not.toHaveBeenCalled();
    expect(capturedPointers.get(marker)?.has(4)).toBe(false);
  });

  it('cancels a pending preview frame when the marker layer unmounts', () => {
    const onMoveBolt = vi.fn();
    const { unmount } = render(
      <div className="relative h-[200px] w-[400px]">
        <AssemblyProcedureMarkerLayer bolts={[bolt]} onMoveBolt={onMoveBolt} />
      </div>
    );

    const marker = screen.getByRole('button', { name: '締付点1' });
    fireEvent.pointerDown(marker, { button: 0, pointerId: 7, clientX: 170, clientY: 120 });
    fireEvent.pointerMove(marker, { pointerId: 7, clientX: 300, clientY: 150 });
    expect(rafCallbacks.size).toBe(1);

    unmount();

    expect(rafCallbacks.size).toBe(0);
    expect(onMoveBolt).not.toHaveBeenCalled();
  });

  it('stops marker pointer propagation without making check markers draggable', () => {
    const onMoveBolt = vi.fn();
    const onParentPointerDown = vi.fn();
    render(
      <div onPointerDown={onParentPointerDown}>
        <AssemblyProcedureMarkerLayer
          bolts={[bolt]}
          checkItems={[checkItem]}
          onMoveBolt={onMoveBolt}
        />
      </div>
    );

    const boltMarker = screen.getByRole('button', { name: '締付点1' });
    const checkMarker = screen.getByRole('button', { name: 'チェック1' });
    fireEvent.pointerDown(boltMarker, { button: 0, pointerId: 5, clientX: 170, clientY: 120 });
    fireEvent.pointerMove(boltMarker, { pointerId: 5, clientX: 300, clientY: 150 });
    fireEvent.pointerUp(boltMarker, { pointerId: 5, clientX: 300, clientY: 150 });
    fireEvent.pointerDown(checkMarker, { button: 0, pointerId: 6, clientX: 90, clientY: 80 });
    fireEvent.pointerMove(checkMarker, { pointerId: 6, clientX: 300, clientY: 150 });
    fireEvent.pointerUp(checkMarker, { pointerId: 6, clientX: 300, clientY: 150 });

    expect(onParentPointerDown).not.toHaveBeenCalled();
    expect(checkMarker).not.toHaveClass('touch-none', 'cursor-move');
    expect(onMoveBolt).toHaveBeenCalledTimes(1);
  });
});
