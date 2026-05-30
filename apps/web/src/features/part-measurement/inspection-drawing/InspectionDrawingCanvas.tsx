import clsx from 'clsx';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import {
  clientToImageRatios,
  computeObjectContainLayout,
  type ObjectContainRect
} from './computeObjectContainLayout';
import { statusForPoint } from './evaluateMeasurement';

import type { InspectionDrawingPoint } from './types';

type Mode = 'place' | 'test';

type Props = {
  imageUrl: string;
  points: InspectionDrawingPoint[];
  mode: Mode;
  selectedPointId: string | null;
  onSelectPoint: (id: string) => void;
  /** 未指定時は図面上への新規配置を無効化（閲覧専用） */
  onAddPoint?: (xRatio: number, yRatio: number) => void;
};

const STATUS_MARKER_CLASS: Record<string, string> = {
  empty: 'bg-white text-slate-900 ring-2 ring-slate-400',
  ok: 'bg-emerald-500 text-white ring-2 ring-emerald-200',
  ng: 'bg-red-600 text-white ring-2 ring-red-200'
};

export function InspectionDrawingCanvas({
  imageUrl,
  points,
  mode,
  selectedPointId,
  onSelectPoint,
  onAddPoint
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ObjectContainRect | null>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  const recomputeLayout = useCallback(() => {
    const el = containerRef.current;
    if (!el || naturalSize.w <= 0 || naturalSize.h <= 0) {
      setLayout(null);
      return;
    }
    setLayout(computeObjectContainLayout(el.clientWidth, el.clientHeight, naturalSize.w, naturalSize.h));
  }, [naturalSize.h, naturalSize.w]);

  useLayoutEffect(() => {
    recomputeLayout();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recomputeLayout());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recomputeLayout]);

  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container || !layout) return;
    const ratios = clientToImageRatios(e.clientX, e.clientY, container.getBoundingClientRect(), layout);
    if (!ratios) return;

    if (mode === 'place') {
      onAddPoint?.(ratios.xRatio, ratios.yRatio);
      return;
    }

    const hit = findNearestPoint(points, ratios.xRatio, ratios.yRatio);
    if (hit) onSelectPoint(hit.id);
  };

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 touch-none select-none overflow-hidden rounded border border-white/20 bg-black/40"
      onPointerDown={handlePointer}
      role="presentation"
    >
      <img
        src={imageUrl}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        onLoad={(ev) => {
          const img = ev.currentTarget;
          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      {layout
        ? points.map((pt, index) => {
            const status = statusForPoint(pt.testValue, pt.lower, pt.upper);
            const left = layout.offsetX + pt.xRatio * layout.width;
            const top = layout.offsetY + pt.yRatio * layout.height;
            const selected = pt.id === selectedPointId;
            return (
              <button
                key={pt.id}
                type="button"
                aria-label={pt.name || `測定点 ${index + 1}`}
                className={clsx(
                  'absolute z-10 flex h-9 min-w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-1 text-sm font-bold tabular-nums shadow-md',
                  STATUS_MARKER_CLASS[status],
                  selected && 'ring-4 ring-amber-300'
                )}
                style={{ left, top }}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  onSelectPoint(pt.id);
                }}
              >
                {index + 1}
              </button>
            );
          })
        : null}
    </div>
  );
}

function findNearestPoint(
  points: InspectionDrawingPoint[],
  xRatio: number,
  yRatio: number
): InspectionDrawingPoint | null {
  const threshold = 0.045;
  let best: InspectionDrawingPoint | null = null;
  let bestDist = Infinity;
  for (const pt of points) {
    const d = Math.hypot(pt.xRatio - xRatio, pt.yRatio - yRatio);
    if (d < threshold && d < bestDist) {
      best = pt;
      bestDist = d;
    }
  }
  return best;
}
