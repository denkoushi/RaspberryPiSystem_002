import { useLayoutEffect, useState, type RefObject } from 'react';

import { pageZoom } from '../pageZoom';

// Measures the gantt pane against a shared value-sheet container so both machines' sheets line up.
export function usePlanningBoardSharedSheetBounds(valueSheetContainer: HTMLElement | null | undefined, viewport: RefObject<HTMLDivElement | null>) {
  const [sharedBounds, setSharedBounds] = useState({ height: 0, top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const pane = viewport.current;
    if (!valueSheetContainer || !pane) return;
    const measure = () => {
      const containerRect = valueSheetContainer.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      const zoom = pageZoom();
      const next = { height: valueSheetContainer.clientHeight,
        top: (paneRect.top - containerRect.top) / zoom, bottom: (paneRect.bottom - containerRect.top) / zoom };
      setSharedBounds(current => current.height === next.height && current.top === next.top && current.bottom === next.bottom ? current : next);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(valueSheetContainer);
    observer?.observe(pane);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [valueSheetContainer, viewport]);
  return sharedBounds;
}
