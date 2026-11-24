import { useLayoutEffect, useRef, useState } from 'react';

import type { CSSProperties, PointerEvent } from 'react';

type Position = { left: number; top: number };
type Drag = { id: number; x: number; y: number; origin: Position; moved: boolean };
const dragThreshold = 4;

function clampPosition(position: Position, pill: HTMLElement, container: HTMLElement | null): Position {
  const { width, height } = pill.getBoundingClientRect();
  const maxLeft = Math.max(0, (container?.clientWidth ?? window.innerWidth) - width);
  const maxTop = Math.max(0, (container?.clientHeight ?? window.innerHeight) - height);
  return {
    left: Math.min(maxLeft, Math.max(0, position.left)),
    top: Math.min(maxTop, Math.max(0, position.top))
  };
}

export function useDraggablePill(withinParent: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const positioned = position !== null;

  useLayoutEffect(() => {
    const pill = ref.current;
    if (!positioned || !pill) return;
    const container = withinParent ? pill.parentElement : null;
    const clamp = () => {
      const { left, top } = pill.style;
      const next = clampPosition({ left: parseFloat(left), top: parseFloat(top) }, pill, container);
      setPosition(current => current?.left === next.left && current.top === next.top ? current : next);
    };
    const observer = new ResizeObserver(clamp);
    observer.observe(pill);
    if (container) observer.observe(container);
    window.addEventListener('resize', clamp);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', clamp);
    };
  }, [positioned, withinParent]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current || (event.target as Element).closest('button')) return;
    const pill = event.currentTarget;
    const bounds = withinParent ? pill.parentElement?.getBoundingClientRect() : null;
    const { left, top } = pill.getBoundingClientRect();
    pill.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
      origin: { left: left - (bounds?.left ?? 0), top: top - (bounds?.top ?? 0) }
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!active.moved && Math.hypot(dx, dy) < dragThreshold) return;
    active.moved = true;
    const pill = event.currentTarget;
    setPosition(clampPosition({ left: active.origin.left + dx, top: active.origin.top + dy },
      pill, withinParent ? pill.parentElement : null));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };

  const style: CSSProperties | undefined = position
    ? { ...position, bottom: 'auto', right: 'auto', width: 'max-content' } : undefined;
  return { ref, style, onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag };
}
