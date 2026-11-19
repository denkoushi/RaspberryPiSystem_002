import { useCallback, useId, useLayoutEffect, useRef } from 'react';

import { inspectionDrawingPointHasCalloutTip } from './inspectionDrawingCalloutTip';
import { computeDimensionGeometry } from './inspectionDrawingDimensionGeometry';

import type { InspectionDrawingCalloutDim, InspectionDrawingPoint } from './types';
import type { PointerEvent } from 'react';

type ImageRect = { width: number; height: number; offsetX: number; offsetY: number };
type Props = {
  points: InspectionDrawingPoint[];
  selectedPointId: string | null;
  image: ImageRect;
  width: number;
  height: number;
  editable: boolean;
  onChange?: (id: string, dims: InspectionDrawingCalloutDim[]) => void;
};

export function InspectionDrawingDimensionLayer({ points, selectedPointId, image, width, height, editable, onChange }: Props) {
  const id = useId().replace(/:/g, '');
  const hasEditableHandles = editable && !!onChange && points.some((point) => point.id === selectedPointId
    && inspectionDrawingPointHasCalloutTip(point) && !!point.calloutDims?.length);
  return (
    <svg className={`pointer-events-none absolute inset-0${hasEditableHandles ? ' z-30' : ''}`} width={width} height={height} aria-label="寸法線">
      <defs>
        {['selected', 'other'].map((tone) => (
          <marker key={tone} id={`${id}-${tone}`} viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
            <path d="M0 1 L10 5 L0 9 z" fill={tone === 'selected' ? '#22d3ee' : '#f59e0b'} />
          </marker>
        ))}
      </defs>
      {points.filter(inspectionDrawingPointHasCalloutTip).map((point) => (point.calloutDims ?? []).map((dim) => (
        <Dimension key={`${point.id}-${dim.dir}`} point={point} dim={dim} image={image}
          selected={point.id === selectedPointId} editable={editable && point.id === selectedPointId && !!onChange}
          markerId={`${id}-${point.id === selectedPointId ? 'selected' : 'other'}`} onChange={onChange} />
      )))}
    </svg>
  );
}

function Dimension({ point, dim, image, selected, editable, markerId, onChange }: {
  point: InspectionDrawingPoint; dim: InspectionDrawingCalloutDim; image: ImageRect;
  selected: boolean; editable: boolean; markerId: string; onChange: Props['onChange'];
}) {
  const group = useRef<SVGGElement>(null);
  const drag = useRef<{
    pointerId: number; clientX: number; clientY: number; kind: 'base' | 'offset';
    rect: DOMRect; grabX: number; grabY: number;
    pending: InspectionDrawingCalloutDim | null; frame: number | null;
  } | null>(null);
  const geometry = useCallback((value: InspectionDrawingCalloutDim) =>
    computeDimensionGeometry(value, point.calloutTipXRatio!, point.calloutTipYRatio!, image),
  [point.calloutTipXRatio, point.calloutTipYRatio, image]);
  const g = geometry(dim);
  const color = selected ? '#22d3ee' : '#f59e0b';
  const apply = useCallback((value: InspectionDrawingCalloutDim) => {
    const next = geometry(value);
    group.current?.querySelectorAll('line').forEach((line, index) => {
      const { start, end } = next.lines[index];
      line.setAttribute('x1', String(start.x)); line.setAttribute('y1', String(start.y));
      line.setAttribute('x2', String(end.x)); line.setAttribute('y2', String(end.y));
    });
    group.current?.querySelectorAll('circle').forEach((circle) => {
      const pos = circle.dataset.handle === 'base' ? next.base : next.handle;
      circle.setAttribute('cx', String(pos.x)); circle.setAttribute('cy', String(pos.y));
    });
  }, [geometry]);
  useLayoutEffect(() => () => {
    if (!drag.current) return;
    if (drag.current.frame != null) cancelAnimationFrame(drag.current.frame);
    apply(dim);
    drag.current = null;
  }, [editable, dim, apply]);
  const move = (event: PointerEvent<SVGCircleElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!current.pending && Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) < 4) return;
    const rect = current.rect;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const x = clamp((event.clientX - current.grabX - rect.left - image.offsetX) / image.width);
    const y = clamp((event.clientY - current.grabY - rect.top - image.offsetY) / image.height);
    current.pending = current.kind === 'base' ? { ...dim, baseXRatio: x, baseYRatio: y }
      : { ...dim, offsetRatio: dim.dir === 'x' ? y : x };
    if (current.frame == null) current.frame = requestAnimationFrame(() => {
      current.frame = null;
      if (current.pending) apply(current.pending);
    });
    event.preventDefault();
  };
  const finish = (event: PointerEvent<SVGCircleElement>, cancelled: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!cancelled && current.pending) move(event);
    if (current.frame != null) cancelAnimationFrame(current.frame);
    drag.current = null;
    if (cancelled) apply(dim);
    else if (current.pending) {
      apply(current.pending);
      onChange?.(point.id, (point.calloutDims ?? []).map((value) => value.dir === dim.dir ? current.pending! : value));
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <g ref={group} data-dimension={`${point.id}-${dim.dir}`} stroke={color}>
      {g.lines.map(({ start, end }, index) => <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y}
        strokeWidth={index === 2 ? 3 : 1.6} markerStart={index === 2 ? `url(#${markerId})` : undefined}
        markerEnd={index === 2 ? `url(#${markerId})` : undefined} />)}
      {editable ? ([g.base, g.handle]).map((position, index) => (
        <g key={index}>
          <circle data-handle={index === 0 ? 'base' : 'offset'} cx={position.x} cy={position.y} r={11}
            fill={color} fillOpacity={0.25} strokeWidth={2} />
          <circle data-handle={index === 0 ? 'base' : 'offset'} cx={position.x} cy={position.y} r={21}
            fill="transparent" stroke="none" className="pointer-events-auto touch-none cursor-grab" aria-label={`${dim.dir.toUpperCase()}寸法${index === 0 ? '基準点' : '位置'}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (event.button !== 0) return;
            const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
            drag.current = { rect, grabX: event.clientX - rect.left - position.x,
              grabY: event.clientY - rect.top - position.y, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
              kind: index === 0 ? 'base' : 'offset', pending: null, frame: null };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }} onPointerMove={move} onPointerUp={(event) => finish(event, false)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => finish(event, true)} />
        </g>
      )) : null}
    </g>
  );
}
