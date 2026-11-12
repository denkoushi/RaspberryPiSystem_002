import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { SeibanShelfColumn } from './planningBoardSeibanShelfData';

// w-56, gap-2 and p-2 in the shelf's horizontal flex strip.
export const SHELF_COLUMN_STRIDE = 232;
const COLUMN_WIDTH = 224;
const PADDING = 8;
const OVERSCAN = 2;

export function usePlanningBoardShelfWindow(columns: readonly SeibanShelfColumn[], open: boolean,
  focusedSeiban: string | null, highlightedSeiban: string | null, highlightedItemId: string | null) {
  const viewport = useRef<HTMLDivElement>(null);
  const [window, setWindow] = useState({ start: 0, end: 0 });
  const measure = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    const width = element.clientWidth || COLUMN_WIDTH;
    const maxScroll = Math.max(0, columns.length * SHELF_COLUMN_STRIDE + PADDING - width);
    if (element.scrollLeft > maxScroll) element.scrollLeft = maxScroll;
    const left = Math.max(0, element.scrollLeft - PADDING);
    const start = Math.min(columns.length, Math.max(0, Math.floor((left + SHELF_COLUMN_STRIDE - COLUMN_WIDTH) / SHELF_COLUMN_STRIDE) - OVERSCAN));
    const end = Math.min(columns.length, Math.ceil((left + width) / SHELF_COLUMN_STRIDE) + OVERSCAN);
    setWindow(current => current.start === start && current.end === end ? current : { start, end });
  }, [columns.length]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; measure(); });
    };
    measure();
    element.addEventListener('scroll', schedule, { passive: true });
    globalThis.window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', schedule);
      globalThis.window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [open, measure]);
  const reveal = useCallback((seiban: string | null) => {
    const element = viewport.current;
    const index = columns.findIndex(column => column.seiban === seiban);
    if (!element || index < 0) return;
    const left = PADDING + index * SHELF_COLUMN_STRIDE;
    const right = left + COLUMN_WIDTH;
    const width = element.clientWidth || COLUMN_WIDTH;
    if (left < element.scrollLeft + PADDING) element.scrollLeft = left - PADDING;
    else if (right > element.scrollLeft + width - PADDING) element.scrollLeft = right - width + PADDING;
    measure();
  }, [columns, measure]);
  // Run only when the focus/selection changes (or the strip reopens/filters), never on manual scrolling.
  useLayoutEffect(() => { if (open) reveal(focusedSeiban); }, [open, focusedSeiban, reveal]);
  useLayoutEffect(() => { if (open) reveal(highlightedSeiban); }, [open, highlightedItemId, highlightedSeiban, reveal]);
  return { viewport, window, reveal };
}
