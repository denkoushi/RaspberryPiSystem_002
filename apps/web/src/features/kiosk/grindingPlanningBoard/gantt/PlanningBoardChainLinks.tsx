import { useLayoutEffect, useState } from 'react';

import { pageZoom } from '../pageZoom';

import { planningBoardProcessGroupKey } from './planningBoardChainStripBars';
import { ganttBarGeometry } from './planningBoardGanttGeometry';

import type { NormalGanttBar as GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { GanttBarLocations } from './planningBoardSingleResourceWindows';
import type { PlanningBoardChainView } from './usePersistedPlanningBoardChainView';
import type { RefObject } from 'react';

export type ChainLinkGeometry = {
  view?: PlanningBoardChainView;
  barLocations?: GanttBarLocations;
  bars: GanttBar[];
  content: RefObject<HTMLDivElement | null>;
  layout: GanttLayout;
  rowElements: RefObject<Map<string, HTMLDivElement>>;
  barRows: ReadonlyMap<string, string>;
  labelWidth: number;
  dayWidth: number;
  viewportWidth: number;
  viewportHeight: number | null;
  rowGeometryKey?: unknown;
  pieceLayer?: RefObject<HTMLDivElement | null>;
};
type Props = ChainLinkGeometry;
export type ChainLink = { id: string; path: string; x: number; y: number };

export type ChainBarPosition = { first: { left: number; top: number; width: number; height: number }; last: { left: number; top: number; width: number; height: number } };

export function planningBoardChainPositions({ content, bars, barLocations, rowElements, barRows, labelWidth, layout, dayWidth }: ChainLinkGeometry) {
  const element = content.current;
  if (!element) return new Map<string, ChainBarPosition | null>();
  const bounds = element.getBoundingClientRect();
  const zoom = pageZoom();
  const rowTops = new Map<HTMLDivElement, number>();
  const rowTop = (row: HTMLDivElement) => {
    const cached = rowTops.get(row);
    if (cached !== undefined) return cached;
    const top = (row.getBoundingClientRect().top - bounds.top) / zoom;
    rowTops.set(row, top);
    return top;
  };
  const forward = layout.mode === 'forward';
  const position = (bar: GanttBar) => {
    const locations = barLocations?.get(bar.item.itemId);
    const row = rowElements.current.get(locations?.first.rowKey ?? barRows.get(bar.item.itemId)!);
    const lastRow = locations ? rowElements.current.get(locations.last.rowKey) : row;
    const first = ganttBarGeometry(locations?.first.bar ?? bar, locations?.first.start ?? layout.start, dayWidth, forward, false, Boolean(row?.dataset.ganttWindowRow), Number(row?.dataset.ganttVerticalScale ?? 1));
    const last = ganttBarGeometry(locations?.last.bar ?? bar, locations?.last.start ?? layout.start, dayWidth, forward, true, Boolean(lastRow?.dataset.ganttWindowRow), Number(lastRow?.dataset.ganttVerticalScale ?? 1));
    if (!row || !lastRow || !first || !last) return null;
    const top = rowTop(row);
    const lastTop = rowTop(lastRow);
    return {
      first: { ...first, left: labelWidth + first.left, top: top + first.top },
      last: { ...last, left: labelWidth + last.left, top: lastTop + last.top }
    };
  };
  return new Map(bars.map((bar) => [bar.item.itemId, position(bar)]));
}

export function planningBoardHasPieceLinks(bars: GanttBar[]) {
  const parents = new Set<string>();
  return bars.some(({ item }) => {
    if (item.kind !== 'piece' || !item.parentItemId) return false;
    if (parents.has(item.parentItemId)) return true;
    parents.add(item.parentItemId);
    return false;
  });
}

export function planningBoardChainPairs(bars: GanttBar[], view: PlanningBoardChainView): [GanttBar, GanttBar][] {
  const lastIntervalByPiece = new Map<string, string>();
  const processes = new Map<string, GanttBar[]>();
  for (const bar of [...bars].sort((a, b) => (a.item.opRange?.fromOpNo ?? 0) - (b.item.opRange?.fromOpNo ?? 0))) {
    if (bar.item.pieceId) lastIntervalByPiece.set(bar.item.pieceId, bar.item.itemId);
  }
  for (const bar of bars) {
    const key = planningBoardProcessGroupKey(bar.item);
    const process = processes.get(key);
    if (process) process.push(bar);
    else processes.set(key, [bar]);
  }
  if (view === 'pieces') {
    const pieceGroups = new Map<string, GanttBar[]>();
    for (const bar of bars) {
      if (bar.item.kind !== 'piece' || !bar.item.parentItemId) continue;
      const group = pieceGroups.get(bar.item.parentItemId);
      if (group) group.push(bar);
      else pieceGroups.set(bar.item.parentItemId, [bar]);
    }
    return [...pieceGroups.values()].flatMap(group => {
      group.sort((a, b) => (a.item.piecePosition ?? Infinity) - (b.item.piecePosition ?? Infinity) || (a.item.opRange?.fromOpNo ?? 0) - (b.item.opRange?.fromOpNo ?? 0));
      return group.slice(1).map((bar, index): [GanttBar, GanttBar] => [group[index]!, bar]);
    });
  }
  const groups = [...processes.values()];
  return groups.slice(1).flatMap((group, index) => groups[index]!.flatMap(previous =>
    previous.item.opRange && previous.item.itemId !== lastIntervalByPiece.get(previous.item.pieceId!) ? []
      : group.map((bar): [GanttBar, GanttBar] => [previous, bar])));
}

export function planningBoardChainLink(previousBar: GanttBar, bar: GanttBar, previous: ChainBarPosition['last'], next: ChainBarPosition['first'], view: PlanningBoardChainView): ChainLink {
  const pieces = view === 'pieces';
  const x1 = previous.left + previous.width - (pieces ? 2 : 0);
  const y1 = previous.top + (pieces ? 0 : previous.height / 2);
  const x2 = next.left + (pieces ? 2 : 0);
  const y2 = next.top + (pieces ? 0 : next.height / 2);
  const bend = Math.max(24, Math.abs(x2 - x1) / 2);
  return { id: `${previousBar.item.itemId}->${bar.item.itemId}`, x: x2, y: y2,
    path: pieces ? `M ${x1} ${y1} C ${x1} ${y1 - 16}, ${x2} ${y2 - 16}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` };
}

export function PlanningBoardChainLinkPaths({ links, view }: { links: ChainLink[]; view: PlanningBoardChainView }) {
  return <>{links.map((link) => view === 'pieces'
      ? <path key={link.id} data-from-to={link.id} data-testid="planning-gantt-piece-link" d={link.path} fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" />
      : <g key={link.id}>
      <path data-from-to={link.id} data-testid="planning-gantt-chain-link" d={link.path} fill="none" stroke="white" strokeWidth={2.5} strokeDasharray="6 4" />
      <circle cx={link.x} cy={link.y} r={4} fill="white" />
    </g>)}</>;
}

export function PlanningBoardChainLinks({ view = 'process', barLocations, bars, content, rowElements, barRows, labelWidth, layout, dayWidth, viewportWidth, viewportHeight, rowGeometryKey }: Props) {
  const [links, setLinks] = useState<ChainLink[]>([]);
  useLayoutEffect(() => {
    const positions = planningBoardChainPositions({ content, bars, barLocations, rowElements, barRows, labelWidth, layout, dayWidth, viewportWidth, viewportHeight });
    setLinks(planningBoardChainPairs(bars, view).flatMap(([previousBar, bar]) => {
      const previous = positions.get(previousBar.item.itemId)?.last;
      const next = positions.get(bar.item.itemId)?.first;
      return previous && next ? [planningBoardChainLink(previousBar, bar, previous, next, view)] : [];
    }));
  }, [view, barLocations, bars, content, rowElements, barRows, labelWidth, layout, dayWidth, viewportWidth, viewportHeight, rowGeometryKey]);
  return <svg data-testid="planning-gantt-chain-links" aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full">
    <PlanningBoardChainLinkPaths links={links} view={view} />
  </svg>;
}
