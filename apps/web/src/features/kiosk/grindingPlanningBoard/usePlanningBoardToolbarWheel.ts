import { useEffect } from 'react';

import type { RefObject } from 'react';

/** Kiosk mice only have a vertical wheel; turn it into horizontal scrolling for the one-row toolbar. */
export function usePlanningBoardToolbarWheel(toolbar: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = element.scrollWidth - element.clientWidth;
      if (max <= 0) return;
      const movement = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
      const next = Math.min(max, Math.max(0, element.scrollLeft + movement));
      // Leave the wheel to the page once the toolbar is at that end (scrollLeft can be fractional).
      if (Math.abs(next - element.scrollLeft) < 1) return;
      event.preventDefault();
      element.scrollLeft = next;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [toolbar]);
}
