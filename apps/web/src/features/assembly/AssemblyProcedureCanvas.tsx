import { normalizeAssemblyProcedureCropRect } from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';
import {
  pointerClientToZoomedImageRatios,
  shouldConfirmImageCanvasTap,
  useZoomedImageCanvasLayout
} from '../kiosk/image-canvas';

import {
  AssemblyProcedureMarkerLayer,
  type AssemblyCanvasBolt,
  type AssemblyCanvasCheckItem,
  type AssemblyProcedureBoltMoveHandler
} from './AssemblyProcedureMarkerLayer';
import { useAssemblyProcedureContainBox } from './useAssemblyProcedureContainBox';

import type { AssemblyProcedureCropRect, AssemblyProcedurePoint } from '@raspi-system/shared-types';
import type { MouseEvent, ReactNode, RefObject } from 'react';

export type { AssemblyCanvasBolt, AssemblyCanvasCheckItem } from './AssemblyProcedureMarkerLayer';
export { AssemblyMarkerOverlay, AssemblyProcedureMarkerLayer } from './AssemblyProcedureMarkerLayer';

type Props = {
  imageRelativePath: string | null | undefined;
  bolts: AssemblyCanvasBolt[];
  checkItems?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  inputTargetBoltId?: string | null;
  selectedCheckItemId?: string | null;
  onSelectBolt?: (id: string) => void;
  onMoveBolt?: AssemblyProcedureBoltMoveHandler;
  onMoveCheckItem?: AssemblyProcedureBoltMoveHandler;
  onSelectCheckItem?: (id: string) => void;
  onToggleCheckItem?: (id: string) => void;
  onAddBolt?: (xRatio: number, yRatio: number) => void;
  onAddCheckItem?: (xRatio: number, yRatio: number) => void;
  onPlaceCallout?: (xRatio: number, yRatio: number) => void;
  onCreateCrop?: (crop: AssemblyProcedureCropRect) => void;
  cropRect?: AssemblyProcedureCropRect | null;
  onCropChange?: (crop: AssemblyProcedureCropRect) => void;
  /** A domain-owned layer rendered in the same measured source-page frame. */
  overlay?: ReactNode;
  placementMode?: 'bolt' | 'check';
  placementAction?: 'place' | 'callout' | 'crop';
  zoom?: number;
  fitGeneration?: number;
  className?: string;
};

function useNaturalSizeFromImg(rootRef: RefObject<HTMLElement | null>, deps: unknown[]): {
  width: number;
  height: number;
} {
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const img = root.querySelector('img');
    if (!img) return;

    const sync = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setNatural({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };

    sync();
    img.addEventListener('load', sync);
    return () => img.removeEventListener('load', sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes explicit dependency list
  }, deps);

  return natural;
}

export function AssemblyProcedureCanvas({
  imageRelativePath,
  bolts,
  checkItems = [],
  selectedBoltId,
  inputTargetBoltId,
  selectedCheckItemId,
  onSelectBolt,
  onMoveBolt,
  onMoveCheckItem,
  onSelectCheckItem,
  onToggleCheckItem,
  onAddBolt,
  onAddCheckItem,
  onPlaceCallout,
  onCreateCrop,
  cropRect,
  onCropChange,
  overlay,
  placementMode = 'bolt',
  placementAction = 'place',
  zoom = 1,
  fitGeneration = 0,
  className
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const pendingPointerRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    maxMovementPx: number;
    cropStart?: AssemblyProcedurePoint;
  } | null>(null);
  const cropHandleRef = useRef<{
    pointerId: number;
    handle: 'nw' | 'ne' | 'sw' | 'se';
    original: AssemblyProcedureCropRect;
  } | null>(null);
  const [cropPreview, setCropPreview] = useState<AssemblyProcedureCropRect | null>(null);
  const layout = useZoomedImageCanvasLayout(
    viewportRef,
    { w: natural.width, h: natural.height },
    zoom
  );
  const { blobUrl, error } = useProtectedImageBlobUrl(imageRelativePath);

  useLayoutEffect(() => {
    viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  }, [fitGeneration, imageRelativePath]);

  useLayoutEffect(() => {
    setNatural({ width: 0, height: 0 });
    pendingPointerRef.current = null;
  }, [blobUrl]);

  const placementHandler = placementAction === 'callout'
    ? onPlaceCallout
    : placementAction === 'crop'
      ? undefined
    : placementMode === 'check'
      ? onAddCheckItem
      : onAddBolt;

  const clearPendingPointer = (pointerId: number) => {
    const viewport = viewportRef.current;
    if (pendingPointerRef.current?.pointerId === pointerId) {
      pendingPointerRef.current = null;
    }
    if (viewport?.hasPointerCapture(pointerId)) {
      try {
        viewport.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (!placementHandler && !(placementAction === 'crop' && onCreateCrop)) ||
      !layout
    ) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const cropStart =
      placementAction === 'crop'
        ? pointerClientToZoomedImageRatios(
            event.clientX,
            event.clientY,
            viewport.getBoundingClientRect(),
            viewport.scrollLeft,
            viewport.scrollTop,
            layout
          )
        : null;
    if (placementAction === 'crop' && !cropStart) return;
    pendingPointerRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      maxMovementPx: 0,
      cropStart: cropStart ?? undefined
    };
    viewportRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (cropHandleRef.current?.pointerId === event.pointerId && layout) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const point = pointerClientToZoomedImageRatios(
        event.clientX,
        event.clientY,
        viewport.getBoundingClientRect(),
        viewport.scrollLeft,
        viewport.scrollTop,
        layout
      );
      if (!point) return;
      const { handle, original } = cropHandleRef.current;
      const opposite = {
        xRatio: handle.includes('w')
          ? original.xRatio + original.widthRatio
          : original.xRatio,
        yRatio: handle.includes('n')
          ? original.yRatio + original.heightRatio
          : original.yRatio
      };
      onCropChange?.(normalizeAssemblyProcedureCropRect(opposite, point));
      return;
    }
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    pending.maxMovementPx = Math.max(
      pending.maxMovementPx,
      Math.hypot(event.clientX - pending.startClientX, event.clientY - pending.startClientY)
    );
    if (pending.cropStart && layout) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const point = pointerClientToZoomedImageRatios(
        event.clientX,
        event.clientY,
        viewport.getBoundingClientRect(),
        viewport.scrollLeft,
        viewport.scrollTop,
        layout
      );
      if (point) setCropPreview(normalizeAssemblyProcedureCropRect(pending.cropStart, point));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (cropHandleRef.current?.pointerId === event.pointerId) {
      cropHandleRef.current = null;
      clearPendingPointer(event.pointerId);
      return;
    }
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const maxMovementPx = pending.maxMovementPx;
    clearPendingPointer(event.pointerId);
    if (pending.cropStart && placementAction === 'crop' && onCreateCrop && layout) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const end = pointerClientToZoomedImageRatios(
        event.clientX,
        event.clientY,
        viewport.getBoundingClientRect(),
        viewport.scrollLeft,
        viewport.scrollTop,
        layout
      );
      const crop = end
        ? normalizeAssemblyProcedureCropRect(pending.cropStart, end)
        : cropPreview;
      setCropPreview(null);
      if (crop) onCreateCrop(crop);
      return;
    }
    if (!shouldConfirmImageCanvasTap(maxMovementPx) || !placementHandler || !layout) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const ratios = pointerClientToZoomedImageRatios(
      event.clientX,
      event.clientY,
      viewport.getBoundingClientRect(),
      viewport.scrollLeft,
      viewport.scrollTop,
      layout
    );
    if (ratios) placementHandler(ratios.xRatio, ratios.yRatio);
  };

  if (!imageRelativePath) {
    return (
      <div className={clsx('flex min-h-[18rem] items-center justify-center bg-slate-950 text-sm text-white/60', className)}>
        手順書を選択
      </div>
    );
  }

  if (error) {
    return (
      <div className={clsx('flex min-h-[18rem] items-center justify-center bg-slate-950 text-sm text-rose-200', className)}>
        {error}
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      data-testid="assembly-procedure-canvas"
      className={clsx(
        'relative min-h-0 overflow-auto bg-slate-950',
        zoom > 1 ? 'touch-pan-x touch-pan-y' : 'touch-none',
        className
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(event) => clearPendingPointer(event.pointerId)}
    >
      {blobUrl ? (
        layout ? (
          <div className="relative" style={{ width: layout.contentWidth, height: layout.contentHeight }}>
            <div
              className="absolute"
              style={{
                left: layout.image.offsetX,
                top: layout.image.offsetY,
                width: layout.image.width,
                height: layout.image.height
              }}
            >
              <img
                src={blobUrl}
                alt=""
                className="pointer-events-none block h-full w-full select-none"
                draggable={false}
              />
              {overlay}
              <AssemblyProcedureMarkerLayer
                bolts={bolts}
                checkItems={checkItems}
                layoutSize={{ width: layout.image.width, height: layout.image.height }}
                selectedBoltId={selectedBoltId}
                inputTargetBoltId={inputTargetBoltId}
                selectedCheckItemId={selectedCheckItemId}
                onSelectBolt={onSelectBolt}
                onMoveBolt={onMoveBolt}
                onMoveCheckItem={onMoveCheckItem}
                onSelectCheckItem={onSelectCheckItem}
                onToggleCheckItem={onToggleCheckItem}
              />
              {cropRect || cropPreview ? (
                <div
                  data-testid="assembly-procedure-crop-selection"
                  className="pointer-events-none absolute border-2 border-cyan-400 bg-cyan-300/15"
                  style={{
                    left: `${(cropPreview ?? cropRect)!.xRatio * 100}%`,
                    top: `${(cropPreview ?? cropRect)!.yRatio * 100}%`,
                    width: `${(cropPreview ?? cropRect)!.widthRatio * 100}%`,
                    height: `${(cropPreview ?? cropRect)!.heightRatio * 100}%`
                  }}
                >
                  {cropRect && onCropChange
                    ? (['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                        <button
                          key={handle}
                          type="button"
                          aria-label={`矩形${handle}ハンドル`}
                          className={clsx(
                            'pointer-events-auto absolute h-5 w-5 rounded-full border-2 border-slate-950 bg-cyan-300',
                            handle.includes('n') ? '-top-2.5' : '-bottom-2.5',
                            handle.includes('w') ? '-left-2.5' : '-right-2.5'
                          )}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            cropHandleRef.current = {
                              pointerId: event.pointerId,
                              handle,
                              original: cropRect
                            };
                            viewportRef.current?.setPointerCapture(event.pointerId);
                          }}
                        />
                      ))
                    : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <img
            src={blobUrl}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain opacity-0"
            draggable={false}
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
          />
        )
      ) : (
        <div className="flex h-80 w-[42rem] max-w-full items-center justify-center text-sm text-white/60">読み込み中</div>
      )}
    </div>
  );
}

export function AssemblyProcedureImageWithMarkers({
  imageContent,
  bolts,
  checkItems = [],
  selectedBoltId,
  inputTargetBoltId,
  selectedCheckItemId,
  onSelectBolt,
  onMoveCheckItem,
  onSelectCheckItem,
  onToggleCheckItem,
  onPlacementClick,
  overlay,
  fitToParent = false,
  className
}: {
  imageContent: ReactNode;
  bolts: AssemblyCanvasBolt[];
  checkItems?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  inputTargetBoltId?: string | null;
  selectedCheckItemId?: string | null;
  onSelectBolt?: (id: string) => void;
  onMoveCheckItem?: AssemblyProcedureBoltMoveHandler;
  onSelectCheckItem?: (id: string) => void;
  onToggleCheckItem?: (id: string) => void;
  onPlacementClick?: (xRatio: number, yRatio: number) => void;
  /** A readonly/editor-owned layer rendered inside the same image frame as markers. */
  overlay?: ReactNode;
  /** When true, scale the image to the largest size that fits the parent while preserving aspect ratio. */
  fitToParent?: boolean;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const natural = useNaturalSizeFromImg(fitToParent ? viewportRef : frameRef, [imageContent, fitToParent]);
  const fitted = useAssemblyProcedureContainBox(
    viewportRef,
    natural.width,
    natural.height
  );

  const markerLayers = (
    <AssemblyProcedureMarkerLayer
      bolts={bolts}
      checkItems={checkItems}
      layoutSize={
        fitToParent && fitted.width > 0 && fitted.height > 0
          ? { width: fitted.width, height: fitted.height }
          : undefined
      }
      selectedBoltId={selectedBoltId}
      inputTargetBoltId={inputTargetBoltId}
      selectedCheckItemId={selectedCheckItemId}
      onSelectBolt={onSelectBolt}
      onMoveCheckItem={onMoveCheckItem}
      onSelectCheckItem={onSelectCheckItem}
      onToggleCheckItem={onToggleCheckItem}
    />
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onPlacementClick) return;
    const container = frameRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return;
    onPlacementClick(xRatio, yRatio);
  };

  if (!fitToParent) {
    return (
      <div
        ref={frameRef}
        data-testid="assembly-procedure-image-with-markers"
        className={clsx('relative inline-block max-h-full max-w-full', className)}
        onClick={handleClick}
      >
        {imageContent}
        {overlay}
        {markerLayers}
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      data-testid="assembly-procedure-image-with-markers"
      className={clsx('flex h-full min-h-0 w-full items-center justify-center overflow-hidden', className)}
    >
      <div
        ref={frameRef}
        className="relative shrink-0 [&>img]:h-full [&>img]:w-full [&>img]:object-contain [&>div]:h-full [&>div]:w-full"
        style={fitted.width > 0 ? { width: fitted.width, height: fitted.height } : { maxWidth: '100%', maxHeight: '100%' }}
        onClick={handleClick}
      >
        {imageContent}
        {overlay}
        {markerLayers}
      </div>
    </div>
  );
}
