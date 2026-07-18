import clsx from 'clsx';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { ImageMarkerCalloutOverlay } from '../../kiosk/image-canvas';

import { evaluateMeasurementValue, parseMeasurementNumber } from './evaluateMeasurement';
import {
  computeScrollToCenterMarker,
  pointerClientToImageRatios,
  zoomedLayoutMatchesCanvasZoom
} from './inspectionDrawingCanvasLayout';
import { shouldConfirmPlacePointFromPointerMovement } from './inspectionDrawingCanvasPointer';
import { inspectionDrawingCanvasViewportBaseClassName } from './inspectionDrawingKioskUi';
import {
  inspectionDrawingMarkerButtonClass,
  inspectionDrawingMarkerInputTargetOutlineClass
} from './inspectionDrawingMarkerStyles';
import { INSPECTION_DRAWING_ZOOM_DEFAULT } from './inspectionDrawingZoom';
import { toleranceBoundsFromPoint } from './markerNumbering';
import { formatInspectionDrawingPointDisplayName } from './measurementPointSupplement';
import { useZoomedCanvasLayout } from './useZoomedCanvasLayout';

import type { InspectionDrawingPoint } from './types';

type Mode = 'place' | 'callout' | 'test';

type Props = {
  imageUrl: string;
  points: InspectionDrawingPoint[];
  mode: Mode;
  selectedPointId: string | null;
  onSelectPoint: (id: string) => void;
  /** 未指定時は図面上への新規配置を無効化（閲覧専用） */
  onAddPoint?: (xRatio: number, yRatio: number) => void;
  /** 指差しモード: 選択中点の先端を置く */
  onSetCalloutTip?: (xRatio: number, yRatio: number) => void;
  /** 1 = ビューポートにフィット。表示専用（保存座標は ratio のまま） */
  zoom?: number;
  /** 全面表示（fit）操作のたびに増える。スクロール位置リセット用 */
  fitGeneration?: number;
  /** 1 回限りのセンタリング要求（selectedPointId とは独立） */
  focusRequest?: { pointId: string; requestId: number; zoom: number } | null;
  /** プログラムスクロール中は scroll 由来の manual 通知を抑止 */
  onUserScroll?: () => void;
};

type PendingPlacePointer = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  maxMovementPx: number;
};

export function InspectionDrawingCanvas({
  imageUrl,
  points,
  mode,
  selectedPointId,
  onSelectPoint,
  onAddPoint,
  onSetCalloutTip,
  zoom = INSPECTION_DRAWING_ZOOM_DEFAULT,
  fitGeneration = 0,
  focusRequest = null,
  onUserScroll
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const appliedFocusRequestIdRef = useRef<number | null>(null);
  const suppressScrollNotifyRef = useRef(false);
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
    suppressScrollNotifyRef.current = true;
    el.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    appliedFocusRequestIdRef.current = null;
    requestAnimationFrame(() => {
      suppressScrollNotifyRef.current = false;
    });
  }, [fitGeneration]);

  useLayoutEffect(() => {
    appliedFocusRequestIdRef.current = null;
  }, [zoom]);

  useLayoutEffect(() => {
    if (!focusRequest || !zoomedLayout) return;
    if (appliedFocusRequestIdRef.current === focusRequest.requestId) return;
    if (Math.abs(zoom - focusRequest.zoom) > 1e-6) return;
    const point = points.find((pt) => pt.id === focusRequest.pointId);
    const viewport = viewportRef.current;
    if (!point || !viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
    if (
      naturalSize.w <= 0 ||
      naturalSize.h <= 0 ||
      !zoomedLayoutMatchesCanvasZoom(
        zoomedLayout,
        viewport.clientWidth,
        viewport.clientHeight,
        naturalSize.w,
        naturalSize.h,
        focusRequest.zoom
      )
    ) {
      return;
    }

    const scroll = computeScrollToCenterMarker({
      layout: zoomedLayout,
      xRatio: point.xRatio,
      yRatio: point.yRatio,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight
    });
    suppressScrollNotifyRef.current = true;
    viewport.scrollTo({ left: scroll.scrollLeft, top: scroll.scrollTop, behavior: 'instant' });
    appliedFocusRequestIdRef.current = focusRequest.requestId;
    requestAnimationFrame(() => {
      suppressScrollNotifyRef.current = false;
    });
  }, [focusRequest, naturalSize.h, naturalSize.w, points, zoom, zoomedLayout]);

  useLayoutEffect(() => {
    setNaturalSize({ w: 0, h: 0 });
    pendingPlaceRef.current = null;
    appliedFocusRequestIdRef.current = null;
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

    if (mode === 'place' || mode === 'callout') {
      if (mode === 'place' && !onAddPoint) return;
      if (mode === 'callout' && !onSetCalloutTip) return;
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
    if (!ratios) return;
    if (mode === 'callout') {
      onSetCalloutTip?.(ratios.xRatio, ratios.yRatio);
      return;
    }
    onAddPoint?.(ratios.xRatio, ratios.yRatio);
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
      onScroll={() => {
        if (suppressScrollNotifyRef.current || !onUserScroll) return;
        onUserScroll();
      }}
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
          {image ? (
            <ImageMarkerCalloutOverlay
              items={points}
              selectedId={selectedPointId}
              layout={zoomedLayout}
            />
          ) : null}
          {image
            ? points.map((pt) => {
                const bounds = toleranceBoundsFromPoint(pt);
                const parsed = parseMeasurementNumber(pt.testValue);
                const status =
                  'error' in bounds
                    ? 'empty'
                    : evaluateMeasurementValue(parsed, bounds.lowerLimit, bounds.upperLimit);
                const left = image.offsetX + pt.xRatio * image.width;
                const top = image.offsetY + pt.yRatio * image.height;
                const isInputTarget = pt.id === selectedPointId;
                const displayName = formatInspectionDrawingPointDisplayName(pt, `測定点 ${pt.markerNo}`);
                return (
                  <div
                    key={pt.id}
                    className={clsx(
                      'absolute z-10 -translate-x-1/2 -translate-y-1/2',
                      inspectionDrawingMarkerInputTargetOutlineClass(isInputTarget)
                    )}
                    style={{ left, top }}
                  >
                    <button
                      type="button"
                      aria-label={displayName}
                      className={inspectionDrawingMarkerButtonClass(status)}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        onSelectPoint(pt.id);
                      }}
                    >
                      {pt.markerNo}
                    </button>
                  </div>
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
