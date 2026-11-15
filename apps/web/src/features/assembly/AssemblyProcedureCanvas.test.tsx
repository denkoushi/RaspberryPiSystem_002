import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssemblyProcedureCanvas,
  AssemblyProcedureImageWithMarkers,
  AssemblyProcedureMarkerLayer
} from './AssemblyProcedureCanvas';

describe('AssemblyProcedureCanvas', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  });
  afterEach(() => vi.restoreAllMocks());

  const canvas = (path: string) => (
    <AssemblyProcedureCanvas
      imageRelativePath={path}
      bolts={[]}
      overlay={<div data-testid="canvas-overlay" />}
    />
  );
  const loadImage = (width: number, height: number) => {
    const img = screen.getByTestId('assembly-procedure-canvas').querySelector('img')!;
    Object.defineProperties(img, {
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height }
    });
    fireEvent.load(img);
  };

  it('keeps the overlay DOM node when returning to a previously loaded page', () => {
    const view = render(canvas('blob:canvas-return-a'));
    loadImage(300, 600);
    view.rerender(canvas('blob:canvas-return-b'));
    loadImage(600, 300);
    const overlay = screen.getByTestId('canvas-overlay');

    view.rerender(canvas('blob:canvas-return-a'));
    expect(screen.getByTestId('canvas-overlay')).toBe(overlay);
    expect(overlay.parentElement).toHaveStyle({ width: '300px', height: '600px' });
    view.rerender(canvas('blob:canvas-return-b'));
    expect(screen.getByTestId('canvas-overlay')).toBe(overlay);
    expect(overlay.parentElement).toHaveStyle({ width: '900px', height: '450px' });
  });

  it('waits for onLoad for an image with no remembered natural size', () => {
    const view = render(canvas('blob:canvas-first-a'));
    expect(screen.queryByTestId('canvas-overlay')).not.toBeInTheDocument();
    loadImage(300, 600);
    expect(screen.getByTestId('canvas-overlay')).toBeInTheDocument();

    view.rerender(canvas('blob:canvas-first-b'));
    expect(screen.queryByTestId('canvas-overlay')).not.toBeInTheDocument();
    loadImage(600, 300);
    expect(screen.getByTestId('canvas-overlay')).toBeInTheDocument();
  });

  it('corrects and remembers natural size from the visible image load', () => {
    const view = render(canvas('blob:canvas-correct-a'));
    loadImage(300, 600);
    view.rerender(canvas('blob:canvas-correct-b'));
    loadImage(600, 300);
    const overlay = screen.getByTestId('canvas-overlay');
    view.rerender(canvas('blob:canvas-correct-a'));
    loadImage(600, 300);
    expect(screen.getByTestId('canvas-overlay')).toBe(overlay);
    expect(overlay.parentElement).toHaveStyle({ width: '900px', height: '450px' });

    view.rerender(canvas('blob:canvas-correct-b'));
    view.rerender(canvas('blob:canvas-correct-a'));
    expect(screen.getByTestId('canvas-overlay')).toBe(overlay);
    expect(overlay.parentElement).toHaveStyle({ width: '900px', height: '450px' });
  });
});

describe('AssemblyProcedureImageWithMarkers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fits an image inserted by a child after mount and tracks subsequent loads', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 900, height: 594,
      top: 0, right: 900, bottom: 594, left: 0, toJSON: () => ({})
    });
    let showImage: () => void = () => {};
    function DelayedImage() {
      const [visible, setVisible] = useState(false);
      showImage = () => setVisible(true);
      return visible ? <img alt="遅延手順書" src="/page-one.png" /> : null;
    }
    const view = render(
      <AssemblyProcedureImageWithMarkers fitToParent imageContent={<DelayedImage />} bolts={[]} />
    );
    const frame = screen.getByTestId('assembly-procedure-image-with-markers').firstElementChild;
    expect(frame).not.toHaveStyle({ width: '420px' });
    await act(async () => { showImage(); });
    const img = screen.getByRole('img');
    Object.defineProperties(img, {
      naturalWidth: { configurable: true, value: 210 },
      naturalHeight: { configurable: true, value: 297 }
    });
    fireEvent.load(img);
    expect(frame).toHaveStyle({ width: '420px', height: '594px' });

    await act(async () => {
      Object.defineProperties(img, {
        naturalWidth: { configurable: true, value: 297 },
        naturalHeight: { configurable: true, value: 210 }
      });
      img.setAttribute('src', '/page-two.png');
    });
    fireEvent.load(img);
    expect(frame).toHaveStyle({ width: '840px', height: '594px' });
    view.unmount();
    fireEvent.load(img);
  });

  it('keeps natural-size observation when only the imageContent node identity changes', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 594));
    const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(210);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(297);
    const view = render(<AssemblyProcedureImageWithMarkers fitToParent imageContent={<img alt="同じ画像" src="/same.png" />} bolts={[]} />);
    const frame = screen.getByTestId('assembly-procedure-image-with-markers').firstElementChild;
    expect(frame).toHaveStyle({ width: '420px', height: '594px' });
    width.mockClear();
    await act(async () => {
      view.rerender(<AssemblyProcedureImageWithMarkers fitToParent imageContent={<img alt="同じ画像" src="/same.png" />} bolts={[]} />);
    });
    expect(width).not.toHaveBeenCalled();
    expect(frame).toHaveStyle({ width: '420px', height: '594px' });
  });

  it('uses the rendered work-view image size as the callout SVG coordinate space', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 900,
      height: 620,
      top: 0,
      right: 900,
      bottom: 620,
      left: 0,
      toJSON: () => ({})
    });

    render(
      <AssemblyProcedureImageWithMarkers
        fitToParent
        imageContent={<img alt="手順書" src="data:image/svg+xml," />}
        bolts={[
          {
            id: 'bolt-1',
            markerNo: 1,
            xRatio: 0.3,
            yRatio: 0.4,
            calloutTipXRatio: 0.8,
            calloutTipYRatio: 0.2,
            label: '締結1'
          }
        ]}
      />
    );

    expect(await screen.findByTestId('image-marker-callout-svg')).toHaveAttribute(
      'viewBox',
      '0 0 900 620'
    );
  });

  it('renders marker numbers and callouts through the shared normal and compact layers', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      toJSON: () => ({})
    });

    const marker = {
      id: 'shared-bolt',
      markerNo: 7,
      xRatio: 0.5,
      yRatio: 0.5,
      calloutTipXRatio: 1,
      calloutTipYRatio: 0.5,
      label: '共通丸数字7'
    };
    const { rerender } = render(
      <div className="relative h-[100px] w-[200px]">
        <AssemblyProcedureMarkerLayer bolts={[marker]} />
      </div>
    );

    expect(await screen.findByRole('button', { name: '共通丸数字7' })).toHaveStyle({
      left: '50%',
      top: '50%'
    });
    expect(screen.getByTestId('image-marker-callout-svg')).toBeInTheDocument();

    rerender(
      <div className="relative h-[100px] w-[200px]">
        <AssemblyProcedureMarkerLayer bolts={[marker]} density="compact" />
      </div>
    );
    expect(screen.queryByRole('button', { name: '共通丸数字7' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-marker-id="shared-bolt"]')).toHaveTextContent('7');
    expect(screen.getByTestId('image-marker-callout-svg')).toBeInTheDocument();
  });

  it('keeps OK/NG state colors while outlining the current input target', () => {
    render(
      <AssemblyProcedureImageWithMarkers
        imageContent={<img alt="手順書" src="data:image/svg+xml," />}
        inputTargetBoltId="bolt-ng"
        bolts={[
          { id: 'bolt-pending', markerNo: 1, xRatio: 0.1, yRatio: 0.1, label: '未入力', status: 'pending' },
          { id: 'bolt-ok', markerNo: 2, xRatio: 0.2, yRatio: 0.2, label: 'OK', status: 'ok' },
          { id: 'bolt-ng', markerNo: 3, xRatio: 0.3, yRatio: 0.3, label: 'NG', status: 'ng' }
        ]}
      />
    );

    expect(screen.getByRole('button', { name: '未入力' })).toHaveClass('bg-white');
    expect(screen.getByRole('button', { name: 'OK' })).toHaveClass('bg-emerald-500');
    expect(screen.getByRole('button', { name: 'NG' })).toHaveClass('bg-red-600', 'outline-[3px]', 'outline-sky-400');
  });

  it('keeps the editor selection cyan independently from work input targeting', () => {
    render(
      <AssemblyProcedureImageWithMarkers
        imageContent={<img alt="手順書" src="data:image/svg+xml," />}
        selectedBoltId="bolt-1"
        bolts={[
          { id: 'bolt-1', markerNo: 1, xRatio: 0.1, yRatio: 0.1, label: '編集選択', status: 'ok' }
        ]}
      />
    );

    expect(screen.getByRole('button', { name: '編集選択' })).toHaveClass('bg-cyan-300');
    expect(screen.getByRole('button', { name: '編集選択' })).not.toHaveClass('outline-sky-400');
  });
});
