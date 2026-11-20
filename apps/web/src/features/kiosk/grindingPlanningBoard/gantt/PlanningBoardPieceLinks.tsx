import { memo, useId, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { pageZoom } from '../pageZoom';

import { planningBoardChainPositions } from './PlanningBoardChainLinks';
import { isNormalGanttBar } from './planningBoardGanttLayout';

import type { ChainBarPosition, ChainLinkGeometry } from './PlanningBoardChainLinks';

const PART_COLORS = ['#67e8f9', '#f9a8d4', '#fde047', '#a5b4fc', '#86efac', '#fdba74', '#c4b5fd', '#fda4af'];

type Pane = ChainLinkGeometry & { viewport: HTMLDivElement | null };
type Point = { x: number; y: number };
type Gap = Point & { width: number; height: number };
/** Scroll offset plus the pane's visible track area, both in container coordinates. */
type PaneOffset = Point & { box: { left: number; top: number; right: number; bottom: number } };
const pieceLinkWeight = () => (window.innerWidth >= 3000 ? 9 : 4.5) / pageZoom();
type Piece = { pane: number; resource: string; id: string; row: number; rect: ChainBarPosition['first'] };
type Pair = { from: Piece; to: Piece; color: string; depth: number };

function measurePairs(panes: readonly Pane[]): Pair[] {
  const parts = new Map<string, Map<string, Piece>>();
  panes.forEach((pane, index) => {
    const rows = new Map<string, number>();
    const bars = [...(pane.barLocations?.values() ?? [])].map(({ first }) => {
      if (!rows.has(first.rowKey)) rows.set(first.rowKey, rows.size);
      return first.bar;
    }).filter(isNormalGanttBar).filter(bar => bar.item.kind === 'piece');
    const positions = planningBoardChainPositions({ ...pane, bars });
    for (const bar of bars) {
      const rect = positions.get(bar.item.itemId)?.first;
      const pieceId = bar.item.pieceId ?? bar.item.itemId;
      if (!rect || rect.left + rect.width <= pane.labelWidth) continue;
      const rowKey = pane.barLocations?.get(bar.item.itemId)?.first.rowKey;
      const piece = { pane: index, resource: bar.resource, id: bar.item.itemId, row: rows.get(rowKey!)!, rect };
      let part = parts.get(bar.partKey);
      if (!part) { part = new Map(); parts.set(bar.partKey, part); }
      if (!part.has(pieceId)) part.set(pieceId, piece);
    }
  });
  return [...parts.keys()].filter(key => parts.get(key)!.size > 1).sort().flatMap((key, index) => {
    const pieces = [...parts.get(key)!.values()];
    pieces.sort((a, b) => a.pane - b.pane || a.row - b.row || a.rect.left - b.rect.left);
    return pieces.slice(1).map((to, previous) => ({
      from: pieces[previous]!, to, color: PART_COLORS[index % PART_COLORS.length]!, depth: index % 4
    }));
  });
}

const PieceLink = memo(function PieceLink({ pair: { from, to, color, depth }, offsets, weight, duplicate = false }: {
  pair: Pair; offsets?: PaneOffset[]; weight: number; duplicate?: boolean;
}) {
  const sameMachine = from.resource === to.resource;
  // A cross-pane end scrolled out of its own pane stops at that pane's edge without a dot,
  // so it never appears over the other pane's rows.
  const end = (piece: Piece, y: number) => {
    const offset = offsets?.[piece.pane];
    const point = { x: piece.rect.left + piece.rect.width / 2 + (offset?.x ?? 0), y: y + (offset?.y ?? 0) };
    if (!offset) return { ...point, shown: true };
    const { box } = offset;
    const x = Math.min(box.right, Math.max(box.left, point.x));
    const clamped = { x, y: Math.min(box.bottom, Math.max(box.top, point.y)) };
    return { ...clamped, shown: clamped.x === point.x && clamped.y === point.y };
  };
  const start = end(from, from.rect.top + from.rect.height);
  const finish = end(to, to.rect.top + (sameMachine ? to.rect.height : 0));
  if (!start.shown && !finish.shown) return null;
  const { x: x1, y: y1 } = start;
  const { x: x2, y: y2 } = finish;
  const bend = sameMachine
    ? Math.min(from.rect.height * 0.6, 15 + depth * 3)
    : Math.max(weight * 8, (y2 - y1) / 2);
  const path = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 + (sameMachine ? bend : -bend)}, ${x2} ${y2}`;
  return <g fill="none" strokeLinecap="round">
    <path d={path} stroke="#020617" strokeWidth={weight * 5 / 3} />
    <path data-testid={duplicate ? undefined : 'planning-gantt-normal-piece-link'} data-from-to={`${from.id}->${to.id}`} d={path} stroke={color} strokeWidth={weight} />
    {start.shown && <circle cx={x1} cy={y1} r={weight * 0.95} fill={color} stroke="#020617" strokeWidth={weight / 3} />}
    {finish.shown && <circle cx={x2} cy={y2} r={weight * 0.95} fill={color} stroke="#020617" strokeWidth={weight / 3} />}
  </g>;
});

export const PlanningBoardPieceLinks = memo(function PlanningBoardPieceLinks({ panes, container }: { panes: readonly Pane[]; container?: HTMLDivElement | null }) {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [offsets, setOffsets] = useState<PaneOffset[]>([]);
  const [gap, setGap] = useState<Gap | null>(null);
  const [weight, setWeight] = useState(pieceLinkWeight);
  const clipId = useId();
  const { local, cross } = useMemo(() => ({
    local: panes.map((_, index) => pairs.filter(pair => pair.from.pane === index && pair.to.pane === index)),
    cross: pairs.filter(pair => pair.from.pane !== pair.to.pane)
  }), [panes, pairs]);

  useLayoutEffect(() => {
    const measure = () => {
      const measured = measurePairs(panes);
      setPairs(measured);
      setWeight(pieceLinkWeight());
      return measured.length;
    };
    if (!measure()) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const pane of panes) {
      if (pane.content.current) observer?.observe(pane.content.current);
      for (const row of pane.rowElements.current.values()) observer?.observe(row);
    }
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [panes]);

  const hasCrossLinks = cross.length > 0;
  useLayoutEffect(() => {
    if (!hasCrossLinks) return;
    let origins: Point[] = [];
    let frame: number | null = null;
    const update = () => {
      frame = null;
      setOffsets(panes.map((pane, index) => {
        const origin = origins[index]!;
        return {
          x: origin.x - (pane.viewport?.scrollLeft ?? 0),
          y: origin.y - (pane.viewport?.scrollTop ?? 0),
          box: pane.viewport
            ? { left: origin.x + pane.labelWidth, top: origin.y, right: origin.x + pane.viewport.clientWidth, bottom: origin.y + pane.viewport.clientHeight }
            : { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
        };
      }));
    };
    const measure = () => {
      const zoom = pageZoom();
      const origin = container?.getBoundingClientRect();
      const rects = panes.map(pane => pane.viewport?.getBoundingClientRect());
      origins = rects.map(rect => rect && origin ? {
        x: (rect.left - origin.left) / zoom - container!.clientLeft,
        y: (rect.top - origin.top) / zoom - container!.clientTop
      } : { x: 0, y: 0 });
      const [upper, lower] = rects;
      if (upper && lower && origin && container) {
        const height = (lower.top - upper.bottom) / zoom;
        const left = Math.max(upper.left + panes[0]!.labelWidth * zoom, lower.left + panes[1]!.labelWidth * zoom);
        const width = (Math.min(upper.right, lower.right) - left) / zoom;
        setGap(height > 0 && height <= 8 && width > 0 ? {
          x: (left - origin.left) / zoom - container.clientLeft,
          y: (upper.bottom - origin.top) / zoom - container.clientTop, width, height
        } : null);
      } else setGap(null);
      if (frame !== null) cancelAnimationFrame(frame);
      update();
    };
    const onScroll = () => { if (frame === null) frame = requestAnimationFrame(update); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const { viewport } of panes) {
      viewport?.addEventListener('scroll', onScroll, { passive: true });
      if (viewport) observer?.observe(viewport);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      for (const { viewport } of panes) viewport?.removeEventListener('scroll', onScroll);
    };
  }, [panes, hasCrossLinks, container]);

  return <>{panes.map((pane, index) => {
    const layer = pane.pieceLayer?.current;
    const offset = offsets[index];
    const paths = local[index]!;
    if (!layer || (!paths.length && (!cross.length || !offset))) return null;
    // The final machine's arc can extend past the rows. Leave room in the scrollable SVG,
    // while keeping the rows and their bars at their original positions.
    const hasArc = paths.some(({ from, to }) => from.resource === to.resource);
    return createPortal(<svg aria-hidden="true" className="absolute left-0 top-0 w-full"
      style={{ height: hasArc ? 'calc(100% + 32px)' : '100%' }}>
      {paths.map(pair => <PieceLink key={pair.from.id} pair={pair} weight={weight} />)}
      {offset && <g transform={`translate(${-offset.x} ${-offset.y})`}>
        {cross.map(pair => <PieceLink key={pair.from.id} pair={pair} offsets={offsets} weight={weight} duplicate={index !== 0} />)}
      </g>}
    </svg>, layer, index);
  })}
    {gap && hasCrossLinks && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      <defs><clipPath id={clipId}><rect {...gap} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        {cross.map(pair => <PieceLink key={pair.from.id} pair={pair} offsets={offsets} weight={weight} duplicate />)}
      </g>
    </svg>}
  </>;
});
