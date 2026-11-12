import { createContext, useId, useLayoutEffect, useState } from 'react';

import { pageZoom } from '../pageZoom';

import { planningBoardChainLink, PlanningBoardChainLinkPaths, planningBoardChainPairs, planningBoardChainPositions } from './PlanningBoardChainLinks';

import type { ChainBarPosition, ChainLink, ChainLinkGeometry } from './PlanningBoardChainLinks';
import type { NormalGanttBar } from './planningBoardGanttLayout';
import type { PlanningBoardChainView } from './usePersistedPlanningBoardChainView';

export type ChainPane = ChainLinkGeometry & { viewport: HTMLDivElement; headerHeight: number };
export const TwoMachineChainContext = createContext<{
  partKey: string | null;
  focus: (partKey: string | null, resource: string | null) => void;
  bars: NormalGanttBar[];
  view: PlanningBoardChainView;
  changeView: (view: PlanningBoardChainView) => void;
  register: (resource: string, pane: ChainPane | null) => void;
} | null>(null);

type Clip = { x: number; y: number; width: number; height: number };
export function PlanningBoardTwoMachineChainLinks({ container, panes, bars, view }: {
  container: HTMLDivElement | null;
  panes: ReadonlyMap<string, ChainPane>;
  bars: NormalGanttBar[];
  view: PlanningBoardChainView;
}) {
  const clipId = useId();
  const [drawing, setDrawing] = useState<{ links: ChainLink[]; clips: Clip[] }>({ links: [], clips: [] });
  useLayoutEffect(() => {
    if (!container) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const bounds = container.getBoundingClientRect();
      const zoom = pageZoom();
      const positions = new Map<string, { resource: string; position: ChainBarPosition }>();
      const clips: Clip[] = [];
      const edges: { top: number; bottom: number; x: number; width: number }[] = [];
      for (const [resource, pane] of panes) {
        const content = pane.content.current;
        if (!content) continue;
        const rect = content.getBoundingClientRect();
        const viewportRect = pane.viewport.getBoundingClientRect();
        const dx = (rect.left - bounds.left) / zoom;
        const dy = (rect.top - bounds.top) / zoom;
        clips.push({ x: (viewportRect.left - bounds.left) / zoom + pane.labelWidth,
          y: (viewportRect.top - bounds.top) / zoom + pane.headerHeight,
          width: Math.max(0, pane.viewport.clientWidth - pane.labelWidth),
          height: Math.max(0, pane.viewport.clientHeight - pane.headerHeight) });
        edges.push({ top: (viewportRect.top - bounds.top) / zoom, bottom: (viewportRect.bottom - bounds.top) / zoom,
          x: clips.at(-1)!.x, width: clips.at(-1)!.width });
        for (const [id, position] of planningBoardChainPositions(pane)) {
          if (!position) continue;
          positions.set(id, { resource, position: {
            first: { ...position.first, left: position.first.left + dx, top: position.first.top + dy },
            last: { ...position.last, left: position.last.left + dx, top: position.last.top + dy }
          } });
        }
      }
      // Include the pane borders, but never bridge a header or a scrollbar.
      edges.sort((a, b) => a.top - b.top);
      for (let index = 1; index < edges.length; index++) {
        const upper = edges[index - 1]!;
        const lower = edges[index]!;
        const gap = lower.top - upper.bottom;
        const x = Math.max(upper.x, lower.x);
        const width = Math.max(0, Math.min(upper.x + upper.width, lower.x + lower.width) - x);
        if (gap > 0 && gap <= 8) clips.push({ x, y: upper.bottom, width, height: gap });
      }
      const links = planningBoardChainPairs(bars, view).flatMap(([previous, next]) => {
        const from = positions.get(previous.item.itemId);
        const to = positions.get(next.item.itemId);
        return from && to && from.resource !== to.resource
          ? [planningBoardChainLink(previous, next, from.position.last, to.position.first, view)] : [];
      });
      setDrawing({ links, clips });
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(container);
    for (const pane of panes.values()) {
      pane.viewport.addEventListener('scroll', schedule, { passive: true });
      observer?.observe(pane.viewport);
      if (pane.content.current) observer?.observe(pane.content.current);
    }
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      for (const pane of panes.values()) pane.viewport.removeEventListener('scroll', schedule);
    };
  }, [container, panes, bars, view]);
  return <svg data-testid="planning-gantt-cross-pane-links" aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full">
    <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse">
      {drawing.clips.map((clip, index) => <rect key={index} {...clip} />)}
    </clipPath></defs>
    <g clipPath={`url(#${clipId})`}><PlanningBoardChainLinkPaths links={drawing.links} view={view} /></g>
  </svg>;
}
