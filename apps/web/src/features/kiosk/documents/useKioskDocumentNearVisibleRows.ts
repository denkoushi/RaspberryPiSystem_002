import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import {
  KIOSK_DOC_IO_ROOT_MARGIN,
  KIOSK_DOC_IO_THRESHOLDS,
  KIOSK_DOC_NEAR_VISIBLE_RADIUS,
} from './kioskDocumentViewerScrollPolicy';
import { computeNearVisibleIndices, pickBestVisibleRowIndex } from './kioskDocumentViewerVisibility';

export type UseKioskDocumentNearVisibleRowsOptions = {
  /** アクティブ行の前後に実画像をマウントする行数 */
  radius?: number;
  rootMargin?: string;
  /** IntersectionObserver の threshold（既定: 近傍スクロール向けに段数を抑える） */
  thresholds?: number[];
  /**
   * 表示中の文書を識別するキー（例: 要領書 ID）。
   * 文書切替時に近傍マウントの基準インデックスを 0 に戻す。
   */
  documentKey?: string | null;
};

/**
 * スクロールコンテナ内の行を IntersectionObserver で追跡し、
 * アクティブ行近傍だけ画像をマウントするためのインデックス集合を返す。
 * IO コールバックは rAF でまとめ、フレームあたり最大 1 回だけ state を更新する。
 */
export function useKioskDocumentNearVisibleRows(
  scrollRef: RefObject<HTMLElement | null>,
  rowCount: number,
  options?: UseKioskDocumentNearVisibleRowsOptions
) {
  const radius = options?.radius ?? KIOSK_DOC_NEAR_VISIBLE_RADIUS;
  const rootMargin = options?.rootMargin ?? KIOSK_DOC_IO_ROOT_MARGIN;
  const thresholds = options?.thresholds ?? KIOSK_DOC_IO_THRESHOLDS;
  const documentKey = options?.documentKey ?? null;

  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const visibilityRatiosRef = useRef<Map<number, number>>(new Map());
  const rafRef = useRef<number | null>(null);

  const flushActiveIndexFromRef = useCallback(() => {
    rafRef.current = null;
    const nextIndex = pickBestVisibleRowIndex(
      visibilityRatiosRef.current,
      activeIndexRef.current,
      rowCount
    );
    if (nextIndex === activeIndexRef.current) return;
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
  }, [rowCount]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(flushActiveIndexFromRef);
  }, [flushActiveIndexFromRef]);

  useEffect(() => {
    visibilityRatiosRef.current.clear();
    activeIndexRef.current = 0;
    setActiveIndex(0);
  }, [documentKey, rowCount]);

  useEffect(() => {
    const root = scrollRef.current;
    const visibilityRatios = visibilityRatiosRef.current;
    if (!root || rowCount === 0) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const raw = entry.target.getAttribute('data-kiosk-doc-row');
          if (raw === null) continue;
          const idx = parseInt(raw, 10);
          if (!Number.isFinite(idx) || idx < 0) continue;
          const ratio = entry.intersectionRatio;
          if (ratio > 0) {
            visibilityRatios.set(idx, ratio);
          } else {
            visibilityRatios.delete(idx);
          }
        }
        scheduleFlush();
      },
      {
        root,
        rootMargin,
        threshold: thresholds,
      }
    );

    observerRef.current = observer;
    elementsRef.current.forEach((el) => observer.observe(el));

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      visibilityRatios.clear();
      observer.disconnect();
      observerRef.current = null;
    };
  }, [scrollRef, rowCount, rootMargin, scheduleFlush, thresholds]);

  const setRowElement = useCallback((index: number, node: HTMLElement | null) => {
    const obs = observerRef.current;
    const prev = elementsRef.current.get(index);
    if (prev && obs) {
      obs.unobserve(prev);
      visibilityRatiosRef.current.delete(index);
    }
    if (node) {
      elementsRef.current.set(index, node);
      obs?.observe(node);
    } else {
      elementsRef.current.delete(index);
      visibilityRatiosRef.current.delete(index);
    }
  }, []);

  const visibleIndices = useMemo(
    () => computeNearVisibleIndices(activeIndex, rowCount, radius),
    [activeIndex, rowCount, radius]
  );

  const shouldShowImage = useCallback((rowIndex: number) => visibleIndices.has(rowIndex), [visibleIndices]);

  return { setRowElement, shouldShowImage };
}
