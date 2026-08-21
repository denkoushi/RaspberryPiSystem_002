import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureOverlayLayer } from './AssemblyProcedureOverlayLayer';

describe('AssemblyProcedureOverlayLayer', () => {
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
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/storage/assembly-procedure-assets/asset-png');
    expect(screen.getByTestId('assembly-procedure-overlay-text-1').firstElementChild).toHaveStyle({ fontSize: '2.5cqw' });
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
