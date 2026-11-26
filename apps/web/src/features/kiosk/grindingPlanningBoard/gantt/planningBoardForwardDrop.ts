import { pageZoom } from '../pageZoom';

import { canReorderForwardBars } from './planningBoardForwardQueue';

import type { ForwardDragPreview, ForwardMove, ForwardReorder } from './PlanningBoardForwardGanttRow';
import type { GanttBar } from './planningBoardGanttLayout';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export function forwardDropBoard(element: Element | null) {
  return element?.closest('[data-testid="planning-two-machine"]') ?? element?.closest('[data-testid="planning-board-gantt"]');
}

export function allowedForwardDropResources(bar: GanttBar, lanes: readonly ForwardDragLane[],
  canMove?: (item: GrindingPlanningBoardItem, resource: string) => boolean) {
  return new Set(lanes.filter((lane) => lane.resource === bar.resource ||
    (bar.item.kind !== 'test' && canMove?.(bar.item, lane.resource))).map((lane) => lane.resource));
}

export function placeForwardBar(bar: GanttBar, drop: NonNullable<ForwardDragPreview['drop']>,
  reorder?: ForwardReorder, move?: ForwardMove) {
  if (drop.resource !== bar.resource && bar.item.kind !== 'test' && drop.bar?.item.kind !== 'test') {
    move?.(bar.item, drop.resource, drop.bar?.item ?? null, drop.placement);
  } else if (drop.bar) {
    reorder?.(bar.item, drop.bar.item, drop.placement);
  }
}

const DROP_OVERLAYS = '[data-later-queue], [data-forward-queue], [data-planning-send-out]';

type Box = { left: number; top: number; right: number; bottom: number };
type CachedLane = { box: Box; resource: string | undefined; rowKey: string | undefined; trackLeft: number | null };
type DropCache = {
  board: Element;
  laneList: readonly ForwardDragLane[];
  lanes: readonly CachedLane[];
  scrolls: readonly (readonly [Element, number, number])[];
  page: readonly [number, number];
};

// Geometry cache for one drag. Hit testing the whole DOM on every pointer move is the slow part,
// so lane and overlay rectangles are measured once and the drop is computed by arithmetic.
let cacheActive = false;
let cache: DropCache | null = null;
let cacheDirty = true;
let cacheUnusable = false;
const markDirty = () => { cacheDirty = true; };

// Layout can change with no scroll or resize event (row heights, shelf open/close), so observe the elements that hold the lanes.
let observer: ResizeObserver | null = null;
const observed = new Set<Element>();
const geometryListeners = new Set<() => void>();
const onLayoutChange = () => { markDirty(); geometryListeners.forEach((listener) => listener()); };
/** Fires when a drag-time layout change (not scroll or window resize) may have moved the lanes. */
export function subscribeForwardDropGeometry(listener: () => void) {
  geometryListeners.add(listener);
  return () => { geometryListeners.delete(listener); };
}
function observeLayout(elements: readonly Element[]) {
  if (!cacheActive || typeof ResizeObserver === 'undefined') return;
  observer ??= new ResizeObserver(onLayoutChange);
  const wanted = new Set(elements);
  observed.forEach((element) => { if (!wanted.has(element)) { observer!.unobserve(element); observed.delete(element); } });
  wanted.forEach((element) => { if (!observed.has(element)) { observer!.observe(element); observed.add(element); } });
}

const activityListeners = new Set<() => void>();
/** True while a forward drag is in progress (between begin and end of the drop cache). */
export const isForwardDragActive = () => cacheActive;
export function subscribeForwardDragActivity(listener: () => void) {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}

export function invalidateForwardDropCache() { markDirty(); }
export function beginForwardDropCache() {
  if (cacheActive) return;
  cacheActive = true;
  markDirty();
  window.addEventListener('scroll', markDirty, true);
  window.addEventListener('resize', markDirty);
  activityListeners.forEach((listener) => listener());
}
export function endForwardDropCache() {
  if (!cacheActive) return;
  cacheActive = false;
  cache = null;
  cacheUnusable = false;
  observer?.disconnect();
  observer = null;
  observed.clear();
  window.removeEventListener('scroll', markDirty, true);
  window.removeEventListener('resize', markDirty);
  activityListeners.forEach((listener) => listener());
}

const toBox = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
const area = (box: Box) => Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
const contains = (box: Box, x: number, y: number) => x >= box.left && x < box.right && y >= box.top && y < box.bottom;

// Only the part a scroll viewport shows can be hit, and its scrollbars are not a drop target.
function viewportBox(viewport: HTMLElement): Box {
  const rect = viewport.getBoundingClientRect();
  const scale = viewport.offsetWidth > 0 ? rect.width / viewport.offsetWidth : 1;
  const left = rect.left + viewport.clientLeft * scale;
  const top = rect.top + viewport.clientTop * scale;
  return { left, top, right: left + viewport.clientWidth * scale, bottom: top + viewport.clientHeight * scale };
}
function visibleBox(element: Element): Box {
  const own = element.getBoundingClientRect();
  const viewport = element.closest<HTMLElement>('[data-gantt-viewport]');
  if (!viewport) return toBox(own);
  const clip = viewportBox(viewport);
  return { left: Math.max(own.left, clip.left), top: Math.max(own.top, clip.top), right: Math.min(own.right, clip.right), bottom: Math.min(own.bottom, clip.bottom) };
}

function buildDropCache(board: Element, laneList: readonly ForwardDragLane[]): DropCache {
  const viewports = Array.from(board.querySelectorAll<HTMLElement>('[data-gantt-viewport]'));
  const lanes = Array.from(board.querySelectorAll<HTMLElement>('[data-gantt-lane]')).map((element): CachedLane => ({
    box: visibleBox(element), resource: element.dataset.resourceCode, rowKey: element.dataset.ganttWindowRow,
    trackLeft: element.querySelector('[data-gantt-track]')?.getBoundingClientRect().left ?? null }));
  observeLayout([board, ...viewports, ...viewports.flatMap((viewport) => Array.from(viewport.children))]);
  cacheUnusable = !lanes.some((lane) => area(lane.box) > 0);
  return { board, laneList, lanes, scrolls: viewports.map((element) => [element, element.scrollLeft, element.scrollTop] as const),
    page: [window.scrollX, window.scrollY] };
}

function currentDropCache(board: Element, laneList: readonly ForwardDragLane[]): DropCache | null {
  if (!cacheActive) return null;
  const stale = cacheDirty || !cache || cache.board !== board || cache.laneList !== laneList
    || cache.page[0] !== window.scrollX || cache.page[1] !== window.scrollY
    || cache.scrolls.some(([element, left, top]) => element.scrollLeft !== left || element.scrollTop !== top);
  if (stale) { cache = buildDropCache(board, laneList); cacheDirty = false; }
  return cacheUnusable ? null : cache;
}

export function findForwardDrop(clientX: number, clientY: number, source: GanttBar,
  allowed: ReadonlySet<string> | undefined, board: Element | null | undefined,
  lanes: readonly ForwardDragLane[], start: number, dayWidth: number, moving?: ReadonlySet<string>
): ForwardDragPreview['drop'] {
  const cached = board ? currentDropCache(board, lanes) : null;
  let targetResource: string | undefined;
  let rowKey: string | undefined;
  let trackLeft: number | null;
  if (cached) {
    // Overlays may cover a lane but must never receive a Gantt drop. They can appear at any frame, so they are read live.
    const overlay = Array.from(document.querySelectorAll<HTMLElement>(DROP_OVERLAYS))
      .some((element) => contains(visibleBox(element), clientX, clientY));
    if (overlay) return null;
    // Later lanes are descendants of earlier ones in document order, so the last match is the innermost.
    const lane = cached.lanes.filter((candidate) => contains(candidate.box, clientX, clientY)).at(-1);
    targetResource = lane?.resource;
    rowKey = lane?.rowKey;
    trackLeft = lane?.trackLeft ?? null;
  } else {
    const hits = document.elementsFromPoint?.(clientX, clientY) ?? [];
    // Overlays may cover a lane but must never receive a Gantt drop.
    if (hits.some((element) => element.closest(DROP_OVERLAYS))) return null;
    const lane = hits
      .map((element) => element.closest<HTMLElement>('[data-gantt-lane]')).find((element) => element && board?.contains(element));
    targetResource = lane?.dataset.resourceCode;
    rowKey = lane?.dataset.ganttWindowRow;
    trackLeft = lane?.querySelector<HTMLElement>('[data-gantt-track]')?.getBoundingClientRect().left ?? null;
  }
  if (!targetResource || !allowed?.has(targetResource) || source.item.kind === 'test' && targetResource !== source.resource) return null;
  const targetLane = lanes.find((candidate) => candidate.resource === targetResource && (!candidate.rowKey || candidate.rowKey === rowKey));
  if (!targetLane || trackLeft === null) return null;
  return forwardDropInLane((clientX - trackLeft) / pageZoom(), source, targetLane, lanes, start, dayWidth, moving);
}

export function forwardDropInLane(x: number, source: GanttBar, targetLane: ForwardDragLane,
  lanes: readonly ForwardDragLane[], start: number, dayWidth: number, moving?: ReadonlySet<string>
): ForwardDragPreview['drop'] {
  const { resource: targetResource, rowKey } = targetLane;
  start = targetLane.start ?? start;
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
