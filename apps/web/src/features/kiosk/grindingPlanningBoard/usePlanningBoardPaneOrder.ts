import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX } from '../../part-measurement/inspection-drawing/inspectionDrawingCanvasPointer';

const HOLD_MS = 450;

function readOrder(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))] : [];
  } catch {
    return [];
  }
}

type PaneDrag = {
  pointerId: number;
  resource: string;
  handle: HTMLButtonElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
  frame: number | null;
  ghost: HTMLDivElement | null;
  target: HTMLElement | null;
  targetOutline: string;
  originalOpacity: string;
  scrollParent: HTMLElement | null;
};

export function usePlanningBoardPaneOrder(
  resources: readonly string[],
  scope: string,
  paneAtPoint: (x: number, y: number) => HTMLElement | null,
  disabled: boolean
) {
  // Browser-local storage deliberately keeps each kiosk's layout independent.
  const key = `kiosk.planning-board.resource-panes:${scope}`;
  const [saved, setSaved] = useState(() => ({ key, order: readOrder(key) }));
  const pending = useRef<PaneDrag | null>(null);
  const storedOrder = useMemo(() => saved.key === key ? saved.order : readOrder(key), [key, saved]);
  const order = useMemo(() => [
    ...storedOrder.filter((resource) => resources.includes(resource)),
    ...resources.filter((resource) => !storedOrder.includes(resource))
  ], [resources, storedOrder]);

  const clear = useCallback(() => {
    const drag = pending.current;
    if (!drag) return;
    pending.current = null;
    if (drag.timer !== null) clearTimeout(drag.timer);
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    if (drag.target) drag.target.style.outline = drag.targetOutline;
    drag.ghost?.remove();
    drag.handle.style.opacity = drag.originalOpacity;
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  }, []);

  useEffect(() => {
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [clear, key]);
  useEffect(() => {
    if (disabled || (pending.current && !resources.includes(pending.current.resource))) clear();
  }, [clear, disabled, resources]);

  const save = useCallback((next: string[]) => {
    // Keep temporarily absent resources so filtering does not erase their saved position.
    let index = 0;
    const persisted = storedOrder.map((resource) => order.includes(resource) ? next[index++]! : resource);
    persisted.push(...next.slice(index));
    setSaved({ key, order: persisted });
    try {
      localStorage.setItem(key, JSON.stringify(persisted));
    } catch {
      // Storage can be unavailable; the current session can still rearrange panes.
    }
  }, [key, order, storedOrder]);

  const move = useCallback((source: string, target: string) => {
    const from = order.indexOf(source);
    const to = order.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, source);
    save(next);
  }, [order, save]);

  const flush = useCallback(() => {
    const drag = pending.current;
    if (!drag?.ghost) return;
    drag.frame = null;
    drag.ghost.style.transform = `translate3d(${drag.x + 12}px, ${drag.y + 12}px, 0)`;
    if (drag.scrollParent) {
      const bounds = drag.scrollParent.getBoundingClientRect();
      const step = drag.y < bounds.top + 40 ? -12 : drag.y > bounds.bottom - 40 ? 12 : 0;
      const before = drag.scrollParent.scrollTop;
      if (drag.x >= bounds.left && drag.x <= bounds.right) drag.scrollParent.scrollTop += step;
      if (before !== drag.scrollParent.scrollTop) drag.frame = requestAnimationFrame(flush);
    }
    const target = paneAtPoint(drag.x, drag.y);
    if (target === drag.target) return;
    if (drag.target) drag.target.style.outline = drag.targetOutline;
    drag.target = target;
    drag.targetOutline = target?.style.outline ?? '';
    if (target) target.style.outline = '2px solid rgb(110 231 183)';
  }, [paneAtPoint]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, resource: string) => {
    if (disabled || pending.current || event.button !== 0 || event.isPrimary === false) return;
    const handle = event.currentTarget;
    let scrollParent = handle.parentElement;
    while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)) scrollParent = scrollParent.parentElement;
    const drag: PaneDrag = {
      pointerId: event.pointerId, resource, handle,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      timer: null, frame: null, ghost: null, target: null, targetOutline: '', originalOpacity: handle.style.opacity, scrollParent
    };
    pending.current = drag;
    handle.setPointerCapture?.(event.pointerId);
    drag.timer = setTimeout(() => {
      if (pending.current !== drag) return;
      drag.timer = null;
      const ghost = document.createElement('div');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.dataset.planningBoardPaneGhost = '';
      ghost.textContent = handle.textContent;
      ghost.className = 'pointer-events-none fixed left-0 top-0 z-[70] rounded border border-emerald-300 bg-slate-900 px-3 py-2 text-[15px] font-bold text-white';
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      handle.style.opacity = '0.45';
      flush();
    }, HOLD_MS);
    event.stopPropagation();
  }, [disabled, flush]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.ghost && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= INSPECTION_DRAWING_PLACE_POINTER_MOVE_THRESHOLD_PX) {
      clear();
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.ghost && drag.frame === null) drag.frame = requestAnimationFrame(flush);
    event.preventDefault();
    event.stopPropagation();
  }, [clear, flush]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.ghost ? paneAtPoint(event.clientX, event.clientY)?.dataset.resourceCode : null;
    clear();
    if (target) move(drag.resource, target);
    event.stopPropagation();
  }, [clear, move, paneAtPoint]);

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (pending.current?.pointerId === event.pointerId) clear();
    event.stopPropagation();
  }, [clear]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, resource: string) => {
    if (event.key === 'Escape') clear();
    if (disabled || !event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const target = order[order.indexOf(resource) + direction];
    if (target) move(resource, target);
    event.preventDefault();
  }, [clear, disabled, move, order]);

  return { order, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown };
}
