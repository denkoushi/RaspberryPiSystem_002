import { useCallback, useEffect, useRef, useState } from 'react';

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

const HOLD_MS = 450;
const CANCEL_DISTANCE = 10;
const SCROLL_EDGE = 40;
const MAX_SCROLL_STEP = 12;

type Drag = {
  pointerId: number;
  from: number;
  to: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  touch: boolean;
  hold: number;
  frame?: number;
  lifted: boolean;
};

export function usePageReorderDrag(enabled: boolean, onMovePage: (from: number, to: number) => void) {
  const listRef = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const movePage = useRef(onMovePage);
  movePage.current = onMovePage;
  const [holding, setHolding] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ from: number; to: number; left: number; top: number } | null>(null);

  const stop = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    window.clearTimeout(current.hold);
    if (current.frame !== undefined) window.cancelAnimationFrame(current.frame);
    drag.current = null;
    setHolding(null);
    setPreview(null);
  }, []);

  const updatePreview = useCallback((current: Drag) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-reorder-page]') ?? []);
    const source = rows.findIndex(row => Number(row.dataset.reorderPage) === current.from);
    const before = rows.findIndex(row => {
      const rect = row.getBoundingClientRect();
      return current.y < rect.top + rect.height / 2;
    });
    const slot = before < 0 ? rows.length : before;
    const destination = rows[slot > source ? slot - 1 : slot];
    current.to = destination ? Number(destination.dataset.reorderPage) : current.from;
    setPreview({ from: current.from, to: current.to, left: current.x - current.offsetX, top: current.y - current.offsetY });
  }, []);

  useEffect(() => {
    if (!enabled) { stop(); return; }
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.x = event.clientX;
      current.y = event.clientY;
      if (current.lifted) updatePreview(current);
      else if (Math.hypot(current.x - current.startX, current.y - current.startY) >= CANCEL_DISTANCE) {
        suppressClick.current = true;
        stop();
      }
    };
    const up = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (current.lifted) move(event);
      stop();
      if (current.lifted && current.to !== current.from) movePage.current(current.from, current.to);
    };
    const cancel = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      suppressClick.current = true;
      stop();
    };
    // Chromium determines touch-action at pointerdown. A non-passive listener
    // blocks native panning after lift while allowing normal scrolling beforehand.
    const touchMove = (event: TouchEvent) => {
      if (drag.current?.lifted && drag.current.touch && event.cancelable) event.preventDefault();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', stop);
    document.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', stop);
      document.removeEventListener('touchmove', touchMove);
    };
  }, [enabled, stop, updatePreview]);

  const start = useCallback((from: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!enabled || drag.current || event.button !== 0 || event.isPrimary === false) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const current: Drag = {
      pointerId: event.pointerId, from, to: from,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      touch: event.pointerType === 'touch', hold: 0, lifted: false
    };
    const scroll = () => {
      const list = listRef.current;
      if (drag.current !== current || !list) return;
      const { top, bottom } = list.getBoundingClientRect();
      const edge = Math.min(SCROLL_EDGE, (bottom - top) / 3);
      const topPressure = Math.min(edge, Math.max(0, top + edge - current.y));
      const bottomPressure = Math.min(edge, Math.max(0, current.y - bottom + edge));
      if (edge > 0 && topPressure !== bottomPressure) {
        const before = list.scrollTop;
        list.scrollTop += Math.round(MAX_SCROLL_STEP * (bottomPressure - topPressure) / edge);
        if (list.scrollTop !== before) updatePreview(current);
      }
      current.frame = window.requestAnimationFrame(scroll);
    };
    current.hold = window.setTimeout(() => {
      current.lifted = true;
      suppressClick.current = true;
      setHolding(null);
      setPreview({ from, to: from, left: current.x - current.offsetX, top: current.y - current.offsetY });
      current.frame = window.requestAnimationFrame(scroll);
    }, HOLD_MS);
    drag.current = current;
    setHolding(from);
  }, [enabled, updatePreview]);

  return {
    listRef, start, holding, preview,
    onPointerDownCapture: () => { if (!drag.current) suppressClick.current = false; },
    onClickCapture: (event: ReactMouseEvent) => {
      if (!suppressClick.current || event.detail === 0) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
