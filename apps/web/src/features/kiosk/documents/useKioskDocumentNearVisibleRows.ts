import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { computeNearVisibleIndices } from './kioskDocumentViewerVisibility';

const DEFAULT_RADIUS = 2;
const DEFAULT_ROOT_MARGIN = '200px 0px';

export type UseKioskDocumentNearVisibleRowsOptions = {
  /** アクティブ行の前後に実画像をマウントする行数 */
  radius?: number;
  rootMargin?: string;
};

/**
 * スクロールコンテナ内の行を IntersectionObserver で追跡し、
 * アクティブ行近傍だけ画像をマウントするためのインデックス集合を返す。
 */
export function useKioskDocumentNearVisibleRows(
  scrollRef: RefObject<HTMLElement | null>,
  rowCount: number,
  options?: UseKioskDocumentNearVisibleRowsOptions
) {
  const radius = options?.radius ?? DEFAULT_RADIUS;
  const rootMargin = options?.rootMargin ?? DEFAULT_ROOT_MARGIN;

  const [activeIndex, setActiveIndex] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map());

  useEffect(() => {
    setActiveIndex(0);
  }, [rowCount]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || rowCount === 0) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setActiveIndex((prev) => {
          let bestIdx = prev;
          let bestRatio = -1;
          for (const entry of entries) {
            const raw = entry.target.getAttribute('data-kiosk-doc-row');
            if (raw === null) continue;
            const idx = parseInt(raw, 10);
            if (!Number.isFinite(idx) || idx < 0) continue;
            const ratio = entry.intersectionRatio;
            if (ratio > bestRatio) {
              bestRatio = ratio;
              bestIdx = idx;
            }
          }
          if (bestRatio <= 0) {
            return prev;
          }
          return bestIdx;
        });
      },
      {
        root,
        rootMargin,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    observerRef.current = observer;
    elementsRef.current.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [scrollRef, rowCount, rootMargin]);

  const setRowElement = useCallback((index: number, node: HTMLElement | null) => {
    const obs = observerRef.current;
    const prev = elementsRef.current.get(index);
    if (prev && obs) {
      obs.unobserve(prev);
    }
    if (node) {
      elementsRef.current.set(index, node);
      obs?.observe(node);
    } else {
      elementsRef.current.delete(index);
    }
  }, []);

  const visibleIndices = useMemo(
    () => computeNearVisibleIndices(activeIndex, rowCount, radius),
    [activeIndex, rowCount, radius]
  );

  const shouldShowImage = useCallback((rowIndex: number) => visibleIndices.has(rowIndex), [visibleIndices]);

  return { setRowElement, shouldShowImage };
}
