import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  protectedImage: {
    blobUrl: null as string | null,
    error: null as unknown
  }
}));

vi.mock('../../hooks/useProtectedImageBlobUrl', () => ({
  useProtectedImageBlobUrl: () => mocks.protectedImage
}));

vi.mock('./OverlayLayer', () => ({
  OverlayLayer: () => null
}));

import { ImageOverlayFrame } from './ImageOverlayFrame';

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
let viewportSize = { width: 1102, height: 573 };

function setNaturalSize(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height }
  });
  fireEvent.load(image);
}

function frameSize() {
  const frame = screen.getByTestId('image-overlay-frame').firstElementChild;
  if (!(frame instanceof HTMLElement)) throw new Error('image frame was not rendered');
  return {
    width: Number.parseFloat(frame.style.width),
    height: Number.parseFloat(frame.style.height)
  };
}

describe('ImageOverlayFrame', () => {
  beforeEach(() => {
    mocks.protectedImage.blobUrl = null;
    mocks.protectedImage.error = null;
    viewportSize = { width: 1102, height: 573 };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'image-overlay-frame'
          ? viewportSize.width
          : originalClientWidth?.get?.call(this) ?? 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'image-overlay-frame'
          ? viewportSize.height
          : originalClientHeight?.get?.call(this) ?? 0;
      }
    });
  });

  afterEach(() => {
    if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).clientWidth;
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).clientHeight;
  });

  it('measures the viewport when a protected image URL resolves after the loading view', () => {
    const view = render(
      <ImageOverlayFrame imageUrl="/images/first.png" protectedImage />
    );
    expect(screen.getByRole('status')).toHaveTextContent('画像を読み込み中');

    mocks.protectedImage.blobUrl = 'blob:first';
    view.rerender(<ImageOverlayFrame imageUrl="/images/first.png" protectedImage />);
    const image = screen.getByRole('img');
    setNaturalSize(image, 1600, 900);

    expect(frameSize()).toEqual({ width: expect.closeTo(1018.6667, 2), height: expect.closeTo(573, 2) });
  });

  it('recomputes the contain frame after switching to an image with another aspect ratio', () => {
    const view = render(
      <ImageOverlayFrame imageUrl="/images/first.png" protectedImage={false} />
    );
    setNaturalSize(screen.getByRole('img'), 1600, 900);
    expect(frameSize()).toEqual({ width: expect.closeTo(1018.6667, 2), height: expect.closeTo(573, 2) });

    viewportSize = { width: 800, height: 400 };
    view.rerender(<ImageOverlayFrame imageUrl="/images/second.png" protectedImage={false} />);
    const nextImage = screen.getByRole('img');
    const resetFrame = screen.getByTestId('image-overlay-frame').firstElementChild;
    expect(resetFrame).toHaveStyle({ width: '100%', height: '100%' });
    setNaturalSize(nextImage, 800, 1200);

    expect(frameSize()).toEqual({ width: expect.closeTo(266.6667, 2), height: expect.closeTo(400, 2) });
  });
});
