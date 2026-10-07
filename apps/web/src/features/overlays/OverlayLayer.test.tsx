import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorInspector } from '../assembly/document-editor/AssemblyProcedureDocumentEditorInspector';

import { OverlayLayer } from './OverlayLayer';

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
