import { type RefObject } from 'react';

import { useZoomedImageCanvasLayout } from '../../kiosk/image-canvas';

import type { ZoomedCanvasLayout } from './inspectionDrawingCanvasLayout';

export type NaturalImageSize = { w: number; h: number };

/**
 * ビューポート計測と ResizeObserver を担当。等価 layout への setState を抑止する。
 */
export function useZoomedCanvasLayout(
  viewportRef: RefObject<HTMLDivElement | null>,
  naturalSize: NaturalImageSize,
  zoom: number
): ZoomedCanvasLayout | null {
  return useZoomedImageCanvasLayout(viewportRef, naturalSize, zoom);
}
