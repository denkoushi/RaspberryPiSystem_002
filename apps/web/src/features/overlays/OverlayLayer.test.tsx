import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorInspector } from '../assembly/document-editor/AssemblyProcedureDocumentEditorInspector';

import { OverlayLayer, overlayTextFontSize } from './OverlayLayer';

import type { OverlayElement } from '@raspi-system/shared-types';

const shape: Extract<OverlayElement, { kind: 'SHAPE' }> = {
  id: 'shape-1',
  pageIndex: 0,
  kind: 'SHAPE',
  shape: 'ARROW',
  bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.05 },
  strokeWidthRatio: 0.02,
  zIndex: 0
};

describe('OverlayLayer line geometry', () => {
  let resize: (width: number, height: number) => void;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(function (callback: ResizeObserverCallback) {
      return {
        observe: (target: Element) => {
          resize = (width, height) => act(() => callback([
            { target, contentRect: new DOMRect(0, 0, width, height) } as ResizeObserverEntry
          ], {} as ResizeObserver));
        },
        disconnect
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['LINE', 'ARROW'] as const)('draws %s across the pixel bbox after choosing →', (kind) => {
    const element = { ...shape, shape: kind };
    const onUpdate = vi.fn();
    render(<AssemblyProcedureDocumentEditorInspector
      element={element}
      onUpdate={onUpdate}
      onDelete={vi.fn()}
      onBringForward={vi.fn()}
      onSendBackward={vi.fn()}
      onBringToFront={vi.fn()}
      onSendToBack={vi.fn()}
      onReplaceImage={vi.fn()}
      onRefetchTextCandidates={vi.fn()}
      busy={false}
    />);
    const view = render(<OverlayLayer elements={[element]} />);
    resize(400, 50);
    fireEvent.click(screen.getByRole('button', { name: '右へ' }));
    view.rerender(<OverlayLayer elements={[onUpdate.mock.calls[0]![0] as OverlayElement]} />);

    const svg = view.container.querySelector('svg');
    const line = svg?.querySelector('line');
    expect(svg).toHaveAttribute('viewBox', '0 0 400 50');
    expect(svg).not.toHaveAttribute('preserveAspectRatio', 'none');
    expect(line).toHaveAttribute('x1', '0');
    expect(line).toHaveAttribute('x2', '400');
    expect(Number(line?.getAttribute('y1'))).toBeCloseTo(25);
    expect(Number(line?.getAttribute('y2'))).toBeCloseTo(25);
    expect(line).toHaveAttribute('stroke-width', '2');
    expect(line).toHaveAttribute('vector-effect', 'non-scaling-stroke');
    if (kind === 'ARROW') {
      const marker = svg?.querySelector('marker');
      expect(marker).toHaveAttribute('markerUnits', 'strokeWidth');
      expect(marker).toHaveAttribute('markerWidth', '8');
      expect(marker).toHaveAttribute('markerHeight', '8');
      expect(marker).toHaveAttribute('orient', 'auto');
      expect(marker).toHaveAttribute('refX', '0.08');
    } else {
      expect(svg?.querySelector('marker')).toBeNull();
    }
  });

  it('updates both axes on resize, including a very thin bbox, and disconnects on unmount', () => {
    const view = render(<OverlayLayer elements={[shape]} />);
    resize(400, 4);
    const svg = view.container.querySelector('svg');
    const line = svg?.querySelector('line');
    expect(svg).toHaveAttribute('viewBox', '0 0 400 4');
    expect(line).toHaveAttribute('x1', '0');
    expect(line).toHaveAttribute('y1', '0');
    expect(Number(line?.getAttribute('x2'))).toBeCloseTo(400);
    expect(Number(line?.getAttribute('y2'))).toBeCloseTo(4);

    resize(200, 100);
    expect(svg).toHaveAttribute('viewBox', '0 0 200 100');
    expect(Number(line?.getAttribute('x2'))).toBeCloseTo(200);
    expect(Number(line?.getAttribute('y2'))).toBeCloseTo(100);
    expect(line).toHaveAttribute('stroke-width', '2');
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the previous rendering until a positive bbox size is available', () => {
    const { container } = render(<OverlayLayer elements={[shape]} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 1 1');
    expect(svg?.querySelector('marker')).toHaveAttribute('markerUnits', 'userSpaceOnUse');
    resize(0, 0);
    expect(svg).toHaveAttribute('viewBox', '0 0 1 1');
    resize(400, 50);
    expect(svg).toHaveAttribute('viewBox', '0 0 400 50');
  });

  it('measures immediately and responds to window resizing without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const rect = vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 400, 50));
    const { container } = render(<OverlayLayer elements={[shape]} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 400 50');
    rect.mockReturnValue(new DOMRect(0, 0, 200, 25));
    fireEvent(window, new Event('resize'));
    expect(svg).toHaveAttribute('viewBox', '0 0 200 25');
  });
});

describe('overlayTextFontSize', () => {
  it('scales the font by the crop width so a cropped layer matches the page rendering', () => {
    expect(overlayTextFontSize(0.02)).toBe('2cqw');
    expect(overlayTextFontSize(0.02, null)).toBe('2cqw');
    expect(overlayTextFontSize(0.02, { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.25 })).toBe('4cqw');
    expect(overlayTextFontSize(undefined, { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 })).toBe('2.5cqw');
  });
});


describe('OverlayLayer rendering and pointer scheduling', () => {
  beforeEach(() => vi.stubGlobal('PointerEvent', MouseEvent));
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('does not render an unchanged overlay when another overlay changes', () => {
    const readText = vi.fn(() => 'unchanged');
    const unchanged: OverlayElement = { ...shape, id: 'unchanged', kind: 'TEXT', get text() { return readText(); } };
    const view = render(<OverlayLayer elements={[shape, unchanged]} />);
    readText.mockClear();
    view.rerender(<OverlayLayer elements={[{ ...shape, strokeColor: '#ff0000' }, unchanged]} />);
    expect(readText).not.toHaveBeenCalled();
    expect(screen.getByText('unchanged')).toBeInTheDocument();
  });

  it.each(['move', 'resize'] as const)('coalesces %s events and flushes the final position before ending', mode => {
    let frame: FrameRequestCallback | undefined;
    const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 42; });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
    const update = vi.fn();
    const end = vi.fn(() => expect(update).toHaveBeenLastCalledWith(shape.id, expect.objectContaining(
      mode === 'move' ? { xRatio: expect.closeTo(0.4), yRatio: expect.closeTo(0.5) }
        : { widthRatio: expect.closeTo(0.7), heightRatio: expect.closeTo(0.35) }
    )));
    const start = vi.fn();
    const view = render(<OverlayLayer elements={[shape]} interactive selectedOverlayId={shape.id} onUpdateBBox={update} onInteractionStart={start} onInteractionEnd={end} />);
    const target = screen.getByTestId(mode === 'move' ? `overlay-${shape.id}` : `overlay-${shape.id}-resize-se`);
    const x = mode === 'move' ? 100 : 500;
    const y = mode === 'move' ? 200 : 250;
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: x, clientY: y });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: x + 100, clientY: y + 100 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: x + 200, clientY: y + 200 });
    expect(request).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    act(() => frame?.(0));
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenLastCalledWith(shape.id, expect.objectContaining(mode === 'move'
      ? { xRatio: expect.closeTo(0.3), yRatio: expect.closeTo(0.4) }
      : { widthRatio: expect.closeTo(0.6), heightRatio: expect.closeTo(0.25) }));
    fireEvent.pointerMove(target, { pointerId: 1, clientX: x + 250, clientY: y + 250 });
    fireEvent.pointerUp(target, { pointerId: 1, clientX: x + 300, clientY: y + 300 });
    expect(cancel).toHaveBeenCalledWith(42);
    expect(update).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    act(() => frame?.(1));
    expect(update).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('keeps the last move on cancellation and cancels queued work on unmount', () => {
    const request = vi.fn(() => 42);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
    const update = vi.fn();
    const end = vi.fn();
    const view = render(<OverlayLayer elements={[shape]} interactive onUpdateBBox={update} onInteractionEnd={end} />);
    const target = screen.getByTestId(`overlay-${shape.id}`);
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 200, clientY: 300 });
    fireEvent.pointerCancel(target, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(update).toHaveBeenLastCalledWith(shape.id, expect.objectContaining({ xRatio: expect.closeTo(0.2), yRatio: expect.closeTo(0.3) }));
    expect(end).toHaveBeenCalledOnce();
    fireEvent.pointerDown(target, { button: 0, pointerId: 2, clientX: 100, clientY: 200 });
    fireEvent.pointerMove(target, { pointerId: 2, clientX: 200, clientY: 300 });
    update.mockClear(); cancel.mockClear();
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(42);
    expect(update).not.toHaveBeenCalled();
  });
});
