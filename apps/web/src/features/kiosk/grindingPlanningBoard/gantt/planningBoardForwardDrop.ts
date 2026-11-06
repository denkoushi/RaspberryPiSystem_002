import { pageZoom } from '../pageZoom';

import { canReorderForwardBars } from './planningBoardForwardQueue';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { GanttBar } from './planningBoardGanttLayout';

export function findForwardDrop(clientX: number, clientY: number, source: GanttBar,
  allowed: ReadonlySet<string> | undefined, board: Element | null | undefined,
  lanes: readonly { resource: string; bars: GanttBar[] }[], start: number, dayWidth: number
): ForwardDragPreview['drop'] {
  const hits = document.elementsFromPoint?.(clientX, clientY) ?? [];
  // The later-queue column and tray sit inside a lane but are not a place to drop.
  if (hits.some((element) => element.closest('[data-later-queue]'))) return null;
  const lane = hits
    .map((element) => element.closest<HTMLElement>('[data-gantt-lane]')).find((element) => element && board?.contains(element));
  const targetResource = lane?.dataset.resourceCode;
  if (!targetResource || !allowed?.has(targetResource)) return null;
  const targetLane = lanes.find((candidate) => candidate.resource === targetResource);
  const targetTrack = lane.querySelector<HTMLElement>('[data-gantt-track]');
  if (!targetLane || !targetTrack) return null;
  const x = (clientX - targetTrack.getBoundingClientRect().left) / pageZoom();
  const centre = (bar: GanttBar) => (bar.start! - start) * dayWidth +
    (bar.unknown ? 70 : Math.max(2, ((bar.segments?.[0]?.end ?? bar.end!) - bar.start!) * dayWidth - 2)) / 2;
  const others = targetLane.bars.filter((bar) => bar.item.itemId !== source.item.itemId).sort((a, b) => centre(a) - centre(b));
  if (!others.length) return targetResource === source.resource ? null : { resource: targetResource, bar: null, placement: 'after', left: 0 };
  const target = others.find((bar) => x < centre(bar));
  const bar = target ?? others[others.length - 1]!;
  if (targetResource === source.resource && !canReorderForwardBars(source, bar)) return null;
  return { resource: targetResource, bar, placement: target ? 'before' : 'after', left: ((target ? bar.start! : bar.end!) - start) * dayWidth };
}
