import { pageZoom } from '../pageZoom';

import { canReorderForwardBars } from './planningBoardForwardQueue';

import type { ForwardDragPreview } from './PlanningBoardForwardGanttRow';
import type { GanttBar } from './planningBoardGanttLayout';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';

export function forwardDropBoard(element: Element | null) {
  return element?.closest('[data-testid="planning-two-machine"]') ?? element?.closest('[data-testid="planning-board-gantt"]');
}

export function findForwardDrop(clientX: number, clientY: number, source: GanttBar,
  allowed: ReadonlySet<string> | undefined, board: Element | null | undefined,
  lanes: readonly ForwardDragLane[], start: number, dayWidth: number, moving?: ReadonlySet<string>
): ForwardDragPreview['drop'] {
  const hits = document.elementsFromPoint?.(clientX, clientY) ?? [];
  // Overlays may cover a lane but must never receive a Gantt drop.
  if (hits.some((element) => element.closest('[data-later-queue], [data-forward-queue]'))) return null;
  const lane = hits
    .map((element) => element.closest<HTMLElement>('[data-gantt-lane]')).find((element) => element && board?.contains(element));
  const targetResource = lane?.dataset.resourceCode;
  if (!targetResource || !allowed?.has(targetResource) || source.item.kind === 'test' && targetResource !== source.resource) return null;
  const rowKey = lane.dataset.ganttWindowRow;
  const targetLane = lanes.find((candidate) => candidate.resource === targetResource && (!candidate.rowKey || candidate.rowKey === rowKey));
  const targetTrack = lane.querySelector<HTMLElement>('[data-gantt-track]');
  if (!targetLane || !targetTrack) return null;
  start = targetLane.start ?? start;
  const x = (clientX - targetTrack.getBoundingClientRect().left) / pageZoom();
  const centre = (bar: GanttBar) => (bar.start! - start) * dayWidth +
    (bar.unknown && !rowKey ? 70 : Math.max(2, ((bar.segments?.[0]?.end ?? bar.end!) - bar.start!) * dayWidth - 2)) / 2;
  const others = targetLane.bars.filter((bar) => bar.item.itemId !== source.item.itemId && !moving?.has(bar.item.itemId)).sort((a, b) => centre(a) - centre(b));
  if (!others.length) {
    if (rowKey) {
      const index = lanes.indexOf(targetLane);
      const next = lanes.slice(index + 1).filter((candidate) => candidate.resource === targetResource).flatMap((candidate) => candidate.bars).find((bar) => bar.item.itemId !== source.item.itemId && !moving?.has(bar.item.itemId));
      const previous = lanes.slice(0, index).filter((candidate) => candidate.resource === targetResource).flatMap((candidate) => candidate.bars).filter((bar) => bar.item.itemId !== source.item.itemId && !moving?.has(bar.item.itemId)).at(-1);
      const bar = next ?? previous;
      if (bar && canReorderForwardBars(source, bar)) return { rowKey, resource: targetResource, bar, placement: next ? 'before' : 'after', left: 0 };
    }
    return targetResource === source.resource ? null : { rowKey, resource: targetResource, bar: null, placement: 'after', left: 0 };
  }
  const target = others.find((bar) => x < centre(bar));
  const bar = target ?? others[others.length - 1]!;
  if (targetResource !== source.resource && bar.item.kind === 'test') return null;
  if (targetResource === source.resource && !canReorderForwardBars(source, bar)) return null;
  return { rowKey, resource: targetResource, bar, placement: target ? 'before' : 'after', left: Math.max(0, ((target ? bar.start! : bar.end!) - start) * dayWidth) };
}
