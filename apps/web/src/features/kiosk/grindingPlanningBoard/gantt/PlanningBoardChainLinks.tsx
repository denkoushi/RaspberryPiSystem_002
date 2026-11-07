import { useLayoutEffect, useState } from 'react';

import { pageZoom } from '../pageZoom';

import { ganttBarGeometry } from './planningBoardGanttGeometry';

import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { RefObject } from 'react';

type Props = {
  bars: GanttBar[];
  content: RefObject<HTMLDivElement | null>;
  layout: GanttLayout;
  rowElements: RefObject<Map<string, HTMLDivElement>>;
  barRows: ReadonlyMap<string, string>;
  labelWidth: number;
  dayWidth: number;
  viewportWidth: number;
  viewportHeight: number | null;
};
type Link = { id: string; path: string; x: number; y: number };

export function PlanningBoardChainLinks({ bars, content, rowElements, barRows, labelWidth, layout, dayWidth, viewportWidth, viewportHeight }: Props) {
  const [links, setLinks] = useState<Link[]>([]);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const position = (bar: GanttBar) => {
      const row = rowElements.current.get(barRows.get(bar.item.itemId)!);
      const first = ganttBarGeometry(bar, layout.start, dayWidth, true);
      const last = ganttBarGeometry(bar, layout.start, dayWidth, true, true);
      if (!row || !first || !last) return null;
      const top = (row.getBoundingClientRect().top - bounds.top) / pageZoom();
      return {
        first: { ...first, left: labelWidth + first.left, top: top + first.top },
        last: { ...last, left: labelWidth + last.left, top: top + last.top }
      };
    };
    const positions = new Map(bars.map((bar) => [bar.item.itemId, position(bar)]));
    const processes = new Map<string, GanttBar[]>();
    for (const bar of bars) {
      const key = bar.item.kind === 'piece' && bar.item.parentItemId ? bar.item.parentItemId : bar.item.itemId;
      const process = processes.get(key);
      if (process) process.push(bar);
      else processes.set(key, [bar]);
    }
    const groups = [...processes.values()];
    setLinks(groups.slice(1).flatMap((group, index) => groups[index]!.flatMap((previousBar) => group.flatMap((bar) => {
      const previous = positions.get(previousBar.item.itemId)?.last;
      const next = positions.get(bar.item.itemId)?.first;
      if (!previous || !next) return [];
      const x1 = previous.left + previous.width;
      const y1 = previous.top + previous.height / 2;
      const x2 = next.left;
      const y2 = next.top + next.height / 2;
      const bend = Math.max(24, Math.abs(x2 - x1) / 2);
      return [{ id: `${previousBar.item.itemId}->${bar.item.itemId}`, path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, x: x2, y: y2 }];
    }))));
  }, [bars, content, rowElements, barRows, labelWidth, layout, dayWidth, viewportWidth, viewportHeight]);
  return <svg data-testid="planning-gantt-chain-links" aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full">
    {links.map((link) => <g key={link.id}>
      <path data-from-to={link.id} data-testid="planning-gantt-chain-link" d={link.path} fill="none" stroke="white" strokeWidth={2.5} strokeDasharray="6 4" />
      <circle cx={link.x} cy={link.y} r={4} fill="white" />
    </g>)}
  </svg>;
}
