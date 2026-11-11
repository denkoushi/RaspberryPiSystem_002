import { useEffect, useRef } from 'react';

import { pageZoom } from '../pageZoom';

import type { PointerEvent as ReactPointerEvent } from 'react';

export function usePlanningBoardGanttPan() {
  const pan = useRef<HTMLDivElement | null>(null);
  const panCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => panCleanup.current?.(), []);
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 || event.pointerType !== 'mouse' || pan.current) return;
    event.preventDefault();
    const element = event.currentTarget;
    const { pointerId, clientX: x, clientY: y } = event;
    const left = element.scrollLeft;
    const top = element.scrollTop;
    // A small cover shows the hand: styling the viewport would restyle every bar first, which is slow on big boards.
    const cover = document.createElement('div');
    cover.dataset.planningGanttPanCover = '';
    cover.className = 'fixed inset-0 z-[90] cursor-grabbing';
    document.body.appendChild(cover);
    pan.current = cover;
    cover.setPointerCapture?.(pointerId);
    cover.addEventListener('pointermove', (move) => {
      if (move.pointerId !== pointerId || pan.current !== cover) return;
      element.scrollLeft = left - (move.clientX - x) / pageZoom();
      element.scrollTop = top - (move.clientY - y) / pageZoom();
      move.preventDefault();
    });
    const cleanup = () => {
      window.removeEventListener('blur', cleanup);
      pan.current = null;
      panCleanup.current = null;
      cover.remove();
    };
    panCleanup.current = cleanup;
    window.addEventListener('blur', cleanup);
    const end = (stop: PointerEvent) => {
      if (stop.pointerId !== pointerId || pan.current !== cover) return;
      cleanup();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) cover.addEventListener(type, end);
  };
  return startPan;
}
