import { useLayoutEffect, useState } from 'react';

import { pageZoom } from '../pageZoom';

import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { RefObject } from 'react';

type Props = {
  bars: GanttBar[];
  content: RefObject<HTMLDivElement | null>;
  layout: GanttLayout;
  dayWidth: number;
  viewportWidth: number;
  viewportHeight: number | null;
};
type Link = { id: string; path: string; x: number; y: number };

export function chainBarElement(content: HTMLDivElement, bar: GanttBar, last = false) {
  const index = last && !bar.unknown ? (bar.segments?.length ?? 1) - 1 : 0;
  const testId = `planning-gantt-bar-${bar.item.itemId}${index > 0 ? `-segment-${index}` : ''}`;
  return Array.from(content.querySelectorAll<HTMLButtonElement>('button[data-testid]')).find((element) => element.dataset.testid === testId);
}

export function PlanningBoardChainLinks({ bars, content, layout, dayWidth, viewportWidth, viewportHeight }: Props) {
  const [links, setLinks] = useState<Link[]>([]);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    setLinks(bars.slice(1).flatMap((bar, index) => {
      const previous = chainBarElement(element, bars[index]!, true)?.getBoundingClientRect();
      const next = chainBarElement(element, bar)?.getBoundingClientRect();
      if (!previous || !next) return [];
      const x1 = (previous.right - bounds.left) / pageZoom();
      const y1 = (previous.top + previous.height / 2 - bounds.top) / pageZoom();
      const x2 = (next.left - bounds.left) / pageZoom();
      const y2 = (next.top + next.height / 2 - bounds.top) / pageZoom();
      const bend = Math.max(24, Math.abs(x2 - x1) / 2);
      return [{ id: bar.item.itemId, path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, x: x2, y: y2 }];
    }));
  }, [bars, content, layout, dayWidth, viewportWidth, viewportHeight]);
  return <svg data-testid="planning-gantt-chain-links" aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full">
    {links.map((link) => <g key={link.id}>
      <path data-testid="planning-gantt-chain-link" d={link.path} fill="none" stroke="white" strokeWidth={2.5} strokeDasharray="6 4" />
      <circle cx={link.x} cy={link.y} r={4} fill="white" />
    </g>)}
  </svg>;
}
