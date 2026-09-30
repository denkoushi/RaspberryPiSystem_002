import { useEffect, useState, type RefObject } from 'react';

type Line = { x1: number; y1: number; x2: number; y2: number; width: number; height: number };

type Props = {
  deskRef: RefObject<HTMLElement>;
  tokenRef: RefObject<HTMLElement>;
  listRef: RefObject<HTMLElement>;
  tone: 'signal' | 'cut' | 'pending';
  /** Any value that changes when the rows or the dock re-render. */
  layoutKey: string;
};

/**
 * Curve from the read tag (left) to the row it belongs to (right). The row's tag cell is
 * marked with data-tether; the bound row wins over the merely selected one.
 */
export function TagDeskTether({ deskRef, tokenRef, listRef, tone, layoutKey }: Props) {
  const [line, setLine] = useState<Line | null>(null);

  useEffect(() => {
    const desk = deskRef.current;
    const list = listRef.current;
    if (!desk) return;
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        // A card marked as the source (the record picked in the list) wins over the reader token.
        const token = desk.querySelector<HTMLElement>('[data-tether-source]') ?? tokenRef.current;
        const target = desk.querySelector<HTMLElement>('[data-tether="hit"]') ?? desk.querySelector<HTMLElement>('[data-tether="selected"]');
        if (!token || !target || !list) {
          setLine(null);
          return;
        }
        const d = desk.getBoundingClientRect();
        const a = token.getBoundingClientRect();
        const t = target.getBoundingClientRect();
        const l = list.getBoundingClientRect();
        // Hide the line when the row is scrolled out of the list.
        if (t.bottom < l.top || t.top > l.bottom) {
          setLine(null);
          return;
        }
        setLine({
          x1: a.right - d.left,
          y1: a.top + a.height / 2 - d.top,
          x2: t.left - d.left,
          y2: t.top + t.height / 2 - d.top,
          width: d.width,
          height: d.height
        });
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(desk);
    window.addEventListener('resize', measure);
    list?.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      list?.removeEventListener('scroll', measure);
    };
  }, [deskRef, tokenRef, listRef, layoutKey]);

  if (!line) return null;
  const color = tone === 'cut' ? '#ff5d5d' : '#4cc9f0';
  const mid = line.x1 + (line.x2 - line.x1) / 2;
  return (
    <svg className="pointer-events-none absolute inset-0 z-[5] overflow-visible" width={line.width} height={line.height} aria-hidden>
      <path
        d={`M${line.x1} ${line.y1} C ${mid} ${line.y1}, ${mid} ${line.y2}, ${line.x2} ${line.y2}`}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={tone === 'pending' ? '6 8' : undefined}
        opacity={0.9}
      />
      <circle cx={line.x1} cy={line.y1} r={5} fill={color} />
      <circle cx={line.x2} cy={line.y2} r={5} fill="#070b12" stroke={color} strokeWidth={2} />
    </svg>
  );
}
