import { useRef } from 'react';

import type { PointerEvent } from 'react';

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="dialog"], label';
const TAP_SLOP = 8;

/**
 * A short press on the chart's empty space (not a bar or a button) clears the green and white frames.
 * Drags, scrolls (pointercancel), other buttons and a press that only closes the queue panel do not count.
 */
export function usePlanningBoardGanttBlankTap({ disabled, onBlankTap }: { disabled: boolean; onBlankTap: () => void }) {
  const press = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const isBlank = (event: PointerEvent<HTMLDivElement>) =>
    event.currentTarget.contains(event.target as Node) && event.target instanceof Element && !event.target.closest(INTERACTIVE);
  const moved = (event: PointerEvent<HTMLDivElement>) =>
    press.current !== null && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) >= TAP_SLOP;
  const clear = () => { press.current = null; };
  return {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      press.current = !disabled && event.button === 0 && isBlank(event) && !document.querySelector('[data-forward-queue]')
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => { if (moved(event)) clear(); },
    onPointerCancelCapture: clear,
    onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => {
      const started = press.current;
      const tapped = started !== null && started.pointerId === event.pointerId && event.button === 0 && !moved(event) && isBlank(event);
      clear();
      if (tapped && !disabled) onBlankTap();
    }
  };
}
