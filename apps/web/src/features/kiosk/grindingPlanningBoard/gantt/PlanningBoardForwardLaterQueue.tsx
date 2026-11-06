import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { forwardLaterQueue } from './forwardLaterQueue';

import type { GanttBar } from './planningBoardGanttLayout';
import type { RefObject } from 'react';

export const LATER_QUEUE_EDGE_WIDTH = 14;
type Props = {
  viewport: RefObject<HTMLDivElement | null>;
  lanes: readonly { resource: string; bars: GanttBar[] }[];
  start: number;
  dayWidth: number;
  labelWidth: number;
  viewportWidth: number;
  onOpen: (bar: GanttBar, anchor: HTMLButtonElement) => void;
};

export function PlanningBoardForwardLaterQueue({ viewport, lanes, start, dayWidth, labelWidth, viewportWidth, onOpen }: Props) {
  const [right, setRight] = useState(start);
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    setHosts(Array.from(viewport.current?.querySelectorAll<HTMLElement>('[data-later-queue-host]') ?? []));
    const element = viewport.current;
    if (!element) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      setRight(start + (element.scrollLeft + (element.clientWidth || viewportWidth) - labelWidth - LATER_QUEUE_EDGE_WIDTH) / dayWidth);
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    // The parent's home-position effect runs after layout; measure that position on the next frame too.
    measure();
    schedule();
    element.addEventListener('scroll', schedule, { passive: true });
    return () => { element.removeEventListener('scroll', schedule); if (frame !== null) cancelAnimationFrame(frame); };
  }, [viewport, lanes, start, dayWidth, labelWidth, viewportWidth]);
  return <>{lanes.map((lane, index) => {
    const queue = forwardLaterQueue(lane.bars, right);
    const host = hosts.find((element) => element.dataset.laterQueueHost === `column-${index}`);
    if (!queue.count || !host) return null;
    return createPortal(<button type="button" aria-label={`${lane.resource}の先の待ち`}
      data-later-queue className="pointer-events-auto sticky right-0 z-20 flex shrink-0 items-center justify-center border-l-2 border-slate-700 bg-[#0b1222] text-slate-400"
      style={{ width: LATER_QUEUE_EDGE_WIDTH }} onClick={(event) => onOpen(queue.bars[0]!, event.currentTarget)}>
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 3l5 5-5 5M9 3l5 5-5 5" /></svg>
    </button>, host, lane.resource);
  })}</>;
}
