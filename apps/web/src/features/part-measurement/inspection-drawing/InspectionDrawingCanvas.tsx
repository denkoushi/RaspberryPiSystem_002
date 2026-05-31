import clsx from 'clsx';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { statusForPoint } from './evaluateMeasurement';
import { pointerClientToImageRatios } from './inspectionDrawingCanvasLayout';
import { shouldConfirmPlacePointFromPointerMovement } from './inspectionDrawingCanvasPointer';
import { inspectionDrawingCanvasViewportBaseClassName } from './inspectionDrawingKioskUi';
import { INSPECTION_DRAWING_ZOOM_DEFAULT } from './inspectionDrawingZoom';
import { useZoomedCanvasLayout } from './useZoomedCanvasLayout';

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
  /** 1 = ビューポートにフィット。表示専用（保存座標は ratio のまま） */
  zoom?: number;
  /** 全面表示（fit）操作のたびに増える。スクロール位置リセット用 */
  fitGeneration?: number;
};

type PendingPlacePointer = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  maxMovementPx: number;
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
  onAddPoint,
  zoom = INSPECTION_DRAWING_ZOOM_DEFAULT,
  fitGeneration = 0
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingPlaceRef = useRef<PendingPlacePointer | null>(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const zoomedLayout = useZoomedCanvasLayout(viewportRef, naturalSize, zoom);

  const ratiosAtClient = useCallback(
    (clientX: number, clientY: number): { xRatio: number; yRatio: number } | null => {
      const viewport = viewportRef.current;
      if (!viewport || !zoomedLayout) return null;
      return pointerClientToImageRatios(
        clientX,
        clientY,
        viewport.getBoundingClientRect(),
        viewport.scrollLeft,
        viewport.scrollTop,
        zoomedLayout
      );
    },
    [zoomedLayout]
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  }, [fitGeneration]);

  useLayoutEffect(() => {
    setNaturalSize({ w: 0, h: 0 });
    pendingPlaceRef.current = null;
  }, [imageUrl]);

  const clearPendingPlace = useCallback((pointerId: number) => {
    const viewport = viewportRef.current;
    if (pendingPlaceRef.current?.pointerId === pointerId) {
      pendingPlaceRef.current = null;
    }
    if (viewport?.hasPointerCapture(pointerId)) {
      try {
        viewport.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport || !zoomedLayout) return;

    if (mode === 'place') {
      if (!onAddPoint) return;
      pendingPlaceRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        maxMovementPx: 0
      };
      viewport.setPointerCapture(e.pointerId);
      return;
    }

    const ratios = ratiosAtClient(e.clientX, e.clientY);
    if (!ratios) return;
    const hit = findNearestPoint(points, ratios.xRatio, ratios.yRatio);
    if (hit) onSelectPoint(hit.id);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pending = pendingPlaceRef.current;
    if (!pending || pending.pointerId !== e.pointerId) return;
    pending.maxMovementPx = Math.max(
      pending.maxMovementPx,
      Math.hypot(e.clientX - pending.startClientX, e.clientY - pending.startClientY)
    );
  };

  const handlePlacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const pending = pendingPlaceRef.current;
    if (!pending || pending.pointerId !== e.pointerId) return;

    const { maxMovementPx } = pending;
    clearPendingPlace(e.pointerId);

    if (!shouldConfirmPlacePointFromPointerMovement(maxMovementPx)) return;

    const ratios = ratiosAtClient(e.clientX, e.clientY);
    if (ratios) onAddPoint?.(ratios.xRatio, ratios.yRatio);
  };

  const handlePlacePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pendingPlaceRef.current?.pointerId !== e.pointerId) return;
    clearPendingPlace(e.pointerId);
  };

  const image = zoomedLayout?.image;
  const allowPan = zoom > INSPECTION_DRAWING_ZOOM_DEFAULT;
  const hasNaturalSize = naturalSize.w > 0 && naturalSize.h > 0;

  return (
    <div
      ref={viewportRef}
      className={clsx(
        inspectionDrawingCanvasViewportBaseClassName,
        allowPan ? 'touch-pan-x touch-pan-y' : 'touch-none'
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePlacePointerUp}
      onPointerCancel={handlePlacePointerCancel}
      role="presentation"
    >
      {!hasNaturalSize ? (
        <img
          src={imageUrl}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-0"
          onLoad={(ev) => {
            const img = ev.currentTarget;
            setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
      ) : zoomedLayout ? (
        <div
          className="relative"
          style={{
            width: zoomedLayout.contentWidth,
            height: zoomedLayout.contentHeight
          }}
        >
          <img
            src={imageUrl}
            alt=""
            className="pointer-events-none absolute"
            style={
              image
                ? {
                    left: image.offsetX,
                    top: image.offsetY,
                    width: image.width,
                    height: image.height
                  }
                : undefined
            }
            onLoad={(ev) => {
              const img = ev.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
          {image
            ? points.map((pt, index) => {
                const status = statusForPoint(pt.testValue, pt.lower, pt.upper);
                const left = image.offsetX + pt.xRatio * image.width;
                const top = image.offsetY + pt.yRatio * image.height;
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
      ) : null}
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
