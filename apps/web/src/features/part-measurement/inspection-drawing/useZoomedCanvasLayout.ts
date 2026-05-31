import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';

import {
  computeZoomedCanvasLayout,
  type ZoomedCanvasLayout
} from './inspectionDrawingCanvasLayout';
import { areZoomedCanvasLayoutsEqual } from './inspectionDrawingCanvasLayoutCompare';

export type NaturalImageSize = { w: number; h: number };

/**
 * ビューポート計測と ResizeObserver を担当。等価 layout への setState を抑止する。
 */
export function useZoomedCanvasLayout(
  viewportRef: RefObject<HTMLDivElement | null>,
  naturalSize: NaturalImageSize,
  zoom: number
): ZoomedCanvasLayout | null {
  const [layout, setLayout] = useState<ZoomedCanvasLayout | null>(null);
  const layoutRef = useRef<ZoomedCanvasLayout | null>(null);

  const measureAndUpdate = useCallback(() => {
    if (naturalSize.w <= 0 || naturalSize.h <= 0) {
      layoutRef.current = null;
      setLayout(null);
      return;
    }

    const el = viewportRef.current;
    if (!el) {
      return;
    }

    const next = computeZoomedCanvasLayout(
      el.clientWidth,
      el.clientHeight,
      naturalSize.w,
      naturalSize.h,
      zoom
    );

    if (areZoomedCanvasLayoutsEqual(layoutRef.current, next)) {
      return;
    }

    layoutRef.current = next;
    setLayout(next);
  }, [naturalSize.h, naturalSize.w, viewportRef, zoom]);

  useLayoutEffect(() => {
    measureAndUpdate();
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measureAndUpdate());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureAndUpdate, viewportRef]);

  return layout;
}
