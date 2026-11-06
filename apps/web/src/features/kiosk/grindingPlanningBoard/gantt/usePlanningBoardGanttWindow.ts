import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { RefObject } from 'react';

export type GanttWindow = { left: number; right: number } | null;

/** Track coordinates exclude the sticky resource label. Keep at least one visible width on each side. */
export function usePlanningBoardGanttWindow(viewport: RefObject<HTMLDivElement | null>, labelWidth: number) {
  // Measure before the first paint, avoiding a transient mount of every bar on large boards.
  // A zero clientWidth switches to null (all bars), including in jsdom.
  const [window, setWindow] = useState<GanttWindow>(() => ({ left: Infinity, right: -Infinity }));
  const previous = useRef<GanttWindow>(window);
  const frame = useRef<number | null>(null);
  const measure = useCallback(() => {
    const element = viewport.current;
    const visible = Math.max(0, (element?.clientWidth ?? 0) - labelWidth);
    const chunk = visible > 0 ? Math.floor(Math.max(0, element!.scrollLeft) / visible) : 0;
    const next = visible > 0 ? { left: Math.max(0, (chunk - 1) * visible), right: (chunk + 3) * visible } : null;
    if (previous.current?.left === next?.left && previous.current?.right === next?.right) return;
    previous.current = next;
    setWindow(next);
  }, [viewport, labelWidth]);
  const onScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; measure(); });
  }, [measure]);
  // Also observe programmatic home/scale changes committed by the view's effects.
  useLayoutEffect(measure);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);
  return { window, onScroll, measure };
}
