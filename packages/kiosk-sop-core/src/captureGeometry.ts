import type { KioskSopTarget } from './types.js';

export type KioskSopCaptureRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type KioskSopCaptureViewport = Readonly<{
  width: number;
  height: number;
}>;

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number.`);
  }
}

/** Maps a real target element's bottom-right corner into normalized screenshot space. */
export function computeNormalizedBottomRightAnchor(
  rect: KioskSopCaptureRect,
  viewport: KioskSopCaptureViewport
): KioskSopTarget {
  assertFinitePositive(viewport.width, 'viewport width');
  assertFinitePositive(viewport.height, 'viewport height');
  assertFinitePositive(rect.width, 'target width');
  assertFinitePositive(rect.height, 'target height');
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
    throw new Error('Target position must be finite.');
  }

  const x = (rect.left + rect.width) / viewport.width;
  const y = (rect.top + rect.height) / viewport.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error('Target bottom-right corner must be inside the capture viewport.');
  }
  return { x, y };
}
