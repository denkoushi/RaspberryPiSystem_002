import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';

import {
  areZoomedImageCanvasLayoutsEqual,
  computeZoomedImageCanvasLayout,
  type ZoomedImageCanvasLayout
} from './imageCanvasModel';

export type NaturalImageSize = { w: number; h: number };

export function useZoomedImageCanvasLayout(
  viewportRef: RefObject<HTMLDivElement | null>,
  naturalSize: NaturalImageSize,
  zoom: number
): ZoomedImageCanvasLayout | null {
  const [layout, setLayout] = useState<ZoomedImageCanvasLayout | null>(null);
  const layoutRef = useRef<ZoomedImageCanvasLayout | null>(null);
  const measure = useCallback(() => {
    const element = viewportRef.current;
    const next = element && naturalSize.w > 0 && naturalSize.h > 0
      ? computeZoomedImageCanvasLayout(element.clientWidth, element.clientHeight, naturalSize.w, naturalSize.h, zoom)
      : null;
    if (areZoomedImageCanvasLayoutsEqual(layoutRef.current, next)) return;
    layoutRef.current = next;
    setLayout(next);
  }, [naturalSize.h, naturalSize.w, viewportRef, zoom]);
  useLayoutEffect(() => {
    measure();
    const element = viewportRef.current;
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, viewportRef]);
  return layout;
}
