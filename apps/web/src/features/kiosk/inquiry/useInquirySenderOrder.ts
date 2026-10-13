import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';

const HOLD_MS = 250;
const MOVE_THRESHOLD = 8;

function readOrder(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string')
      ? [...new Set(value)] : [];
  } catch {
    return [];
  }
}

type Drag = {
  id: string;
  pointerId: number;
  handle: HTMLButtonElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
  frame: number | null;
  slots: Array<{ id: string; button: HTMLButtonElement; rect: DOMRect }>;
  next: string[];
  active: boolean;
  preventScroll: (event: TouchEvent) => void;
};

export function useInquirySenderOrder(ids: string[], department: string, disabled: boolean) {
  const key = `kiosk.inquiry.sender-order:${department}`;
  const [saved, setSaved] = useState(() => ({ key, order: readOrder(key) }));
  const stored = useMemo(() => saved.key === key ? saved.order : readOrder(key), [key, saved]);
  const order = useMemo(() => [
    ...stored.filter(id => ids.includes(id)), ...ids.filter(id => !stored.includes(id))
  ], [ids, stored]);
  const pending = useRef<Drag | null>(null);
  const suppressClick = useRef(false);

  const clear = useCallback(() => {
    const drag = pending.current;
    if (!drag) return;
    pending.current = null;
    if (drag.timer !== null) clearTimeout(drag.timer);
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    drag.handle.removeEventListener('touchmove', drag.preventScroll);
    for (const { button } of drag.slots) {
      button.style.transform = '';
      button.removeAttribute('data-reordering');
      button.removeAttribute('data-dragging');
    }
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  }, []);

  useEffect(() => {
    window.addEventListener('blur', clear);
    window.addEventListener('resize', clear);
    // Cached viewport coordinates are invalid after scrolling; abandon the gesture.
    window.addEventListener('scroll', clear, true);
    return () => {
      window.removeEventListener('blur', clear);
      window.removeEventListener('resize', clear);
      window.removeEventListener('scroll', clear, true);
      clear();
    };
  }, [clear, key, ids]);
  useEffect(() => { if (disabled) clear(); }, [clear, disabled]);

  const save = useCallback((next: string[]) => {
    setSaved({ key, order: next });
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Session order still works. */ }
  }, [key]);

  const flush = useCallback(() => {
    const drag = pending.current;
    if (!drag?.active) return;
    drag.frame = null;
    const dx = drag.x - drag.startX;
    const dy = drag.y - drag.startY;
    const source = drag.slots.find(slot => slot.id === drag.id)!;
    // Hit-test cached slots with the dragged button's centre. No layout reads in pointermove.
    const x = source.rect.left + source.rect.width / 2 + dx;
    const y = source.rect.top + source.rect.height / 2 + dy;
    let target = 0;
    let distance = Infinity;
    drag.slots.forEach(({ rect }, index) => {
      const nextDistance = Math.hypot(x - rect.left - rect.width / 2, y - rect.top - rect.height / 2);
      if (nextDistance < distance) { distance = nextDistance; target = index; }
    });
    drag.next = drag.next.filter(id => id !== drag.id);
    drag.next.splice(target, 0, drag.id);
    for (const slot of drag.slots) {
      const destination = drag.slots[drag.next.indexOf(slot.id)]!.rect;
      slot.button.style.transform = slot.id === drag.id
        ? `translate3d(${dx}px, ${dy}px, 0)`
        : `translate3d(${destination.left - slot.rect.left}px, ${destination.top - slot.rect.top}px, 0)`;
    }
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (disabled || pending.current || event.button !== 0 || event.isPrimary === false) return;
    suppressClick.current = false;
    const handle = event.currentTarget;
    const drag: Drag = {
      id, pointerId: event.pointerId, handle, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, timer: null, frame: null, slots: [], next: [...order], active: false,
      preventScroll: event => { if (pending.current?.active && event.cancelable) event.preventDefault(); }
    };
    pending.current = drag;
    // Allow ordinary touch scrolling until the hold completes. React's touch listeners are passive.
    handle.addEventListener('touchmove', drag.preventScroll, { passive: false });
    handle.setPointerCapture?.(event.pointerId);
    drag.timer = setTimeout(() => {
      if (pending.current !== drag) return;
      drag.timer = null;
      drag.slots = Array.from(handle.parentElement!.querySelectorAll<HTMLButtonElement>('[data-sender-id]'))
        .map(button => ({ id: button.dataset.senderId!, button, rect: button.getBoundingClientRect() }));
      drag.active = true;
      suppressClick.current = true;
      for (const { button } of drag.slots) button.dataset.reordering = '';
      handle.dataset.dragging = '';
    }, HOLD_MS);
    event.stopPropagation();
  }, [disabled, order]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= MOVE_THRESHOLD) {
      suppressClick.current = true;
      clear();
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.active) {
      if (drag.frame === null) drag.frame = requestAnimationFrame(flush);
      event.preventDefault();
    }
    event.stopPropagation();
  }, [clear, flush]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.active) {
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      drag.x = event.clientX;
      drag.y = event.clientY;
      flush();
      save(drag.next);
    }
    clear();
    event.stopPropagation();
  }, [clear, flush, save]);

  const onPointerCancel = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (pending.current?.pointerId === event.pointerId) clear();
  }, [clear]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === 'Escape') clear();
    if (!disabled && event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      clear();
      const from = order.indexOf(id);
      const to = from + (event.key === 'ArrowLeft' ? -1 : 1);
      if (from < 0 || to < 0 || to >= order.length) return;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, id);
      save(next);
    }
    if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false;
  }, [clear, disabled, order, save]);

  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (!suppressClick.current) return true;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
    return false;
  }, []);

  return { order, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown, onClick };
}
