import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureOverlayLayer } from './AssemblyProcedureOverlayLayer';

const mockUseProtectedImageBlobUrl = vi.fn();

vi.mock('../../hooks/useProtectedImageBlobUrl', () => ({
  useProtectedImageBlobUrl: (...args: unknown[]) => mockUseProtectedImageBlobUrl(...args)
}));

describe('AssemblyProcedureOverlayLayer', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    mockUseProtectedImageBlobUrl.mockReset();
    mockUseProtectedImageBlobUrl.mockReturnValue({ blobUrl: 'blob:assembly-overlay-image', error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockLayerRect(width = 400, height = 200): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({})
    }));
  }

  it('renders asset-map URLs, proportional text sizing, and crop clipping', () => {
    render(
      <div className="relative h-[200px] w-[400px]">
        <AssemblyProcedureOverlayLayer
          elements={[
            {
              id: 'text-1',
              pageIndex: 0,
              kind: 'TEXT',
              text: '手順',
              bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.2 },
              zIndex: 1,
              style: { fontSizeRatio: 0.025 }
            },
            {
              id: 'image-1',
              pageIndex: 0,
              kind: 'IMAGE',
              assetId: 'asset-png',
              bbox: { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.4 },
              zIndex: 2
            }
            ]}
          assets={{
            'asset-png': {
              assetId: 'asset-png',
              storageKey: 'assembly/asset-png',
              contentType: 'image/png',
              byteSize: 10,
              url: '/api/storage/assembly-procedure-assets/asset-png'
            }
          }}
        />
      </div>
    );

    expect(screen.getByTestId('assembly-procedure-overlay-layer')).toHaveClass('overflow-hidden');
    expect(screen.getByTestId('assembly-procedure-overlay-text-1')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-procedure-overlay-image-1')).toBeInTheDocument();
    expect(mockUseProtectedImageBlobUrl).toHaveBeenCalledWith('/api/storage/assembly-procedure-assets/asset-png');
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:assembly-overlay-image');
    expect(screen.getByTestId('assembly-procedure-overlay-text-1').firstElementChild).toHaveStyle({ fontSize: '2.5cqw' });
  });

  it('does not expose a protected asset URL to the native image element while loading', () => {
    mockUseProtectedImageBlobUrl.mockReturnValue({ blobUrl: null, error: null });
    render(
      <AssemblyProcedureOverlayLayer
        elements={[{
          id: 'image-loading',
          pageIndex: 0,
          kind: 'IMAGE',
          assetId: 'asset-png',
          bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 },
          zIndex: 0
        }]}
        assets={{
          'asset-png': {
            assetId: 'asset-png',
            storageKey: 'assembly/asset-png',
            contentType: 'image/png',
            byteSize: 10,
            url: '/api/storage/assembly-procedure-assets/asset-png'
          }
        }}
      />
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('assembly-procedure-overlay-image-loading')).toHaveTextContent('画像を読み込み中');
    expect(mockUseProtectedImageBlobUrl).toHaveBeenCalledWith('/api/storage/assembly-procedure-assets/asset-png');
  });

  it('supports keyboard selection and ratio nudging with a11y labels', () => {
    const onSelect = vi.fn();
    const onNudge = vi.fn();
    render(
      <AssemblyProcedureOverlayLayer
        interactive
        elements={[
          {
            id: 'shape-1',
            pageIndex: 0,
            kind: 'SHAPE',
            shape: 'ARROW',
            bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 },
            zIndex: 0
          }
        ]}
        onSelect={onSelect}
        onNudge={onNudge}
      />
    );

    const item = screen.getByRole('button', { name: '図形オーバーレイ: ARROW' });
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    fireEvent.keyDown(item, { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(onNudge).toHaveBeenNthCalledWith(1, 'shape-1', 0.005, 0);
    expect(onNudge).toHaveBeenNthCalledWith(2, 'shape-1', 0, -0.02);
    expect(onSelect).toHaveBeenCalledWith('shape-1');
  });

  it('moves interactive overlays and clamps their source bbox to the page', () => {
    mockLayerRect();
    const onUpdateBBox = vi.fn();
    render(
      <AssemblyProcedureOverlayLayer
        interactive
        selectedOverlayId="text-1"
        elements={[{
          id: 'text-1',
          pageIndex: 0,
          kind: 'TEXT',
          text: '移動',
          bbox: { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 },
          zIndex: 0
        }]}
        onUpdateBBox={onUpdateBBox}
      />
    );

    const item = screen.getByTestId('assembly-procedure-overlay-text-1');
    fireEvent.pointerDown(item, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(item, { pointerId: 1, clientX: 160, clientY: 100 });
    fireEvent.pointerUp(item, { pointerId: 1, clientX: 160, clientY: 100 });
    expect(onUpdateBBox.mock.calls.at(-1)?.[0]).toBe('text-1');
    expect(onUpdateBBox.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      xRatio: expect.closeTo(0.3),
      yRatio: expect.closeTo(0.3),
      widthRatio: expect.closeTo(0.2),
      heightRatio: expect.closeTo(0.2)
    }));

    fireEvent.pointerDown(item, { button: 0, pointerId: 2, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(item, { pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(item, { pointerId: 2, clientX: 0, clientY: 0 });
    expect(onUpdateBBox).toHaveBeenLastCalledWith('text-1', {
      xRatio: 0,
      yRatio: 0,
      widthRatio: 0.2,
      heightRatio: 0.2
    });
  });

  it('resizes only the selected overlay with four corner handles and enforces the minimum size', () => {
    mockLayerRect();
    const onUpdateBBox = vi.fn();
    render(
      <AssemblyProcedureOverlayLayer
        interactive
        selectedOverlayId="shape-1"
        elements={[{
          id: 'shape-1',
          pageIndex: 0,
          kind: 'SHAPE',
          shape: 'RECTANGLE',
          bbox: { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 },
          zIndex: 0
        }, {
          id: 'shape-2',
          pageIndex: 0,
          kind: 'SHAPE',
          shape: 'RECTANGLE',
          bbox: { xRatio: 0.6, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 },
          zIndex: 1
        }]}
        onUpdateBBox={onUpdateBBox}
      />
    );

    expect(screen.getAllByRole('button', { name: /リサイズハンドル/ })).toHaveLength(4);
    expect(screen.queryByTestId('assembly-procedure-overlay-shape-2-resize-nw')).not.toBeInTheDocument();

    const northWest = screen.getByTestId('assembly-procedure-overlay-shape-1-resize-nw');
    fireEvent.pointerDown(northWest, { button: 0, pointerId: 3, clientX: 80, clientY: 40 });
    fireEvent.pointerMove(northWest, { pointerId: 3, clientX: 40, clientY: 20 });
    fireEvent.pointerUp(northWest, { pointerId: 3, clientX: 40, clientY: 20 });
    expect(onUpdateBBox.mock.calls.at(-1)?.[0]).toBe('shape-1');
    expect(onUpdateBBox.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      xRatio: expect.closeTo(0.1),
      yRatio: expect.closeTo(0.1),
      widthRatio: expect.closeTo(0.3),
      heightRatio: expect.closeTo(0.3)
    }));

    const southEast = screen.getByTestId('assembly-procedure-overlay-shape-1-resize-se');
    fireEvent.pointerDown(southEast, { button: 0, pointerId: 4, clientX: 160, clientY: 80 });
    fireEvent.pointerMove(southEast, { pointerId: 4, clientX: 81, clientY: 41 });
    fireEvent.pointerUp(southEast, { pointerId: 4, clientX: 81, clientY: 41 });
    expect(onUpdateBBox).toHaveBeenLastCalledWith('shape-1', {
      xRatio: 0.2,
      yRatio: 0.2,
      widthRatio: 0.005,
      heightRatio: 0.005
    });

    fireEvent.keyDown(southEast, { key: 'ArrowRight' });
    expect(onUpdateBBox).toHaveBeenLastCalledWith('shape-1', {
      xRatio: 0.2,
      yRatio: 0.2,
      widthRatio: 0.20500000000000002,
      heightRatio: 0.2
    });
  });

  it('preserves the full source bbox when moving an overlay clipped by a crop', () => {
    mockLayerRect();
    const onUpdateBBox = vi.fn();
    render(
      <AssemblyProcedureOverlayLayer
        interactive
        crop={{ xRatio: 0.25, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.5 }}
        selectedOverlayId="text-crop"
        elements={[{
          id: 'text-crop',
          pageIndex: 0,
          kind: 'TEXT',
          text: 'crop',
          bbox: { xRatio: 0.15, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 },
          zIndex: 0
        }]}
        onUpdateBBox={onUpdateBBox}
      />
    );

    const item = screen.getByTestId('assembly-procedure-overlay-text-crop');
    fireEvent.pointerDown(item, { button: 0, pointerId: 5, clientX: 20, clientY: 40 });
    fireEvent.pointerUp(item, { pointerId: 5, clientX: 20, clientY: 40 });
    expect(onUpdateBBox).not.toHaveBeenCalled();

    fireEvent.pointerDown(item, { button: 0, pointerId: 7, clientX: 20, clientY: 40 });
    fireEvent.pointerMove(item, { pointerId: 7, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(item, { pointerId: 7, clientX: 60, clientY: 60 });
    expect(onUpdateBBox.mock.calls.at(-1)?.[0]).toBe('text-crop');
    expect(onUpdateBBox.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      xRatio: expect.closeTo(0.2),
      yRatio: expect.closeTo(0.25),
      widthRatio: expect.closeTo(0.2),
      heightRatio: expect.closeTo(0.2)
    }));
  });

  it('preserves a crop-hidden source edge while resizing the visible opposite corner', () => {
    mockLayerRect();
    const onUpdateBBox = vi.fn();
    render(
      <AssemblyProcedureOverlayLayer
        interactive
        crop={{ xRatio: 0.25, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.5 }}
        selectedOverlayId="text-crop-resize"
        elements={[{
          id: 'text-crop-resize',
          pageIndex: 0,
          kind: 'TEXT',
          text: 'crop resize',
          bbox: { xRatio: 0.15, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 },
          zIndex: 0
        }]}
        onUpdateBBox={onUpdateBBox}
      />
    );

    const southEast = screen.getByTestId('assembly-procedure-overlay-text-crop-resize-resize-se');
    fireEvent.pointerDown(southEast, { button: 0, pointerId: 8, clientX: 80, clientY: 120 });
    fireEvent.pointerMove(southEast, { pointerId: 8, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(southEast, { pointerId: 8, clientX: 160, clientY: 140 });
    expect(onUpdateBBox.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
      xRatio: expect.closeTo(0.15),
      widthRatio: expect.closeTo(0.3)
    }));
  });

  it('keeps selectable read-only overlays scrollable when bbox updates are unavailable', () => {
    mockLayerRect();
    render(
      <AssemblyProcedureOverlayLayer
        interactive
        selectedOverlayId="text-readonly"
        elements={[{
          id: 'text-readonly',
          pageIndex: 0,
          kind: 'TEXT',
          text: '閲覧',
          bbox: { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 },
          zIndex: 0
        }]}
      />
    );

    const item = screen.getByTestId('assembly-procedure-overlay-text-readonly');
    expect(item).not.toHaveClass('touch-none');
    expect(screen.queryByTestId('assembly-procedure-overlay-text-readonly-resize-nw')).not.toBeInTheDocument();
  });

  it('renders an arrowhead marker that follows the line direction', () => {
    const { container } = render(
      <AssemblyProcedureOverlayLayer
        elements={[
          {
            id: 'arrow-1',
            pageIndex: 0,
            kind: 'SHAPE',
            shape: 'ARROW',
            bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.2 },
            start: { xRatio: 0, yRatio: 0.5 },
            end: { xRatio: 1, yRatio: 0.5 },
            zIndex: 0
          }
        ]}
      />
    );

    const marker = container.querySelector('marker');
    expect(marker).toBeInTheDocument();
    expect(container.querySelector('line')).toHaveAttribute('marker-end', expect.stringContaining('arrowhead'));
    expect(container.querySelector('circle')).not.toBeInTheDocument();
    expect(marker?.querySelector('path')).toHaveAttribute('d', 'M0 0 L0.08 0.04 L0 0.08 Z');
  });

  it('keeps every vector shape stroke visible at the minimum pixel width', () => {
    render(
      <AssemblyProcedureOverlayLayer
        elements={[
          {
            id: 'line-visible',
            pageIndex: 0,
            kind: 'SHAPE',
            shape: 'LINE',
            bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 },
            strokeWidthRatio: 0.006,
            zIndex: 0
          },
          {
            id: 'arrow-visible',
            pageIndex: 0,
            kind: 'SHAPE',
            shape: 'ARROW',
            bbox: { xRatio: 0.3, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 },
            strokeWidthRatio: 0.006,
            zIndex: 1
          },
          {
            id: 'ellipse-visible',
            pageIndex: 0,
            kind: 'SHAPE',
            shape: 'ELLIPSE',
            bbox: { xRatio: 0.6, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 },
            strokeWidthRatio: 0.006,
            zIndex: 2
          }
        ]}
      />
    );

    expect(screen.getByTestId('assembly-procedure-overlay-line-visible').querySelector('line'))
      .toHaveAttribute('stroke-width', '1');
    expect(screen.getByTestId('assembly-procedure-overlay-arrow-visible').querySelector('line'))
      .toHaveAttribute('stroke-width', '1');
    expect(screen.getByTestId('assembly-procedure-overlay-ellipse-visible').querySelector('ellipse'))
      .toHaveAttribute('stroke-width', '1');
  });

  it('keeps the same overlay identity in full and crop views and clips intersections', () => {
    const { container } = render(
      <>
        <div className="relative h-[100px] w-[100px]">
          <AssemblyProcedureOverlayLayer
            elements={[{
              id: 'crossing',
              pageIndex: 0,
              kind: 'TEXT',
              text: '交差',
              bbox: { xRatio: 0.3, yRatio: 0.3, widthRatio: 0.4, heightRatio: 0.4 },
              zIndex: 0
            }, {
              id: 'outside',
              pageIndex: 0,
              kind: 'TEXT',
              text: '範囲外',
              bbox: { xRatio: 0.8, yRatio: 0.8, widthRatio: 0.1, heightRatio: 0.1 },
              zIndex: 1
            }]}
          />
        </div>
        <div className="relative h-[100px] w-[100px]">
          <AssemblyProcedureOverlayLayer
            crop={{ xRatio: 0.1, yRatio: 0.1, widthRatio: 0.4, heightRatio: 0.4 }}
            elements={[{
              id: 'crossing',
              pageIndex: 0,
              kind: 'TEXT',
              text: '交差',
              bbox: { xRatio: 0.3, yRatio: 0.3, widthRatio: 0.4, heightRatio: 0.4 },
              zIndex: 0
            }, {
              id: 'outside',
              pageIndex: 0,
              kind: 'TEXT',
              text: '範囲外',
              bbox: { xRatio: 0.8, yRatio: 0.8, widthRatio: 0.1, heightRatio: 0.1 },
              zIndex: 1
            }]}
          />
        </div>
      </>
    );

    expect(container.querySelectorAll('[data-testid="assembly-procedure-overlay-crossing"]')).toHaveLength(2);
    const cropOverlay = container.querySelectorAll('[data-testid="assembly-procedure-overlay-crossing"]')[1];
    expect(Number.parseFloat(cropOverlay?.getAttribute('style')?.match(/left:\s*([^;]+)/)?.[1] ?? 'NaN')).toBeCloseTo(50);
    expect(Number.parseFloat(cropOverlay?.getAttribute('style')?.match(/top:\s*([^;]+)/)?.[1] ?? 'NaN')).toBeCloseTo(50);
    expect(cropOverlay).toHaveStyle({ width: '50%', height: '50%' });
    expect(container.querySelectorAll('[data-testid="assembly-procedure-overlay-outside"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="assembly-procedure-overlay-layer"]')[1]).toHaveClass('overflow-hidden');
  });
});
