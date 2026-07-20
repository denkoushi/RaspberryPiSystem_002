import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';
import {
  ImageMarkerCalloutOverlay,
  pointerClientToZoomedImageRatios,
  shouldConfirmImageCanvasTap,
  useZoomedImageCanvasLayout
} from '../kiosk/image-canvas';

import { computeContainSize } from './computeContainSize';

import type { ZoomedImageCanvasLayout } from '../kiosk/image-canvas';
import type { MouseEvent, ReactNode, RefObject } from 'react';

type AssemblyCanvasCallout = {
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
};

export type AssemblyCanvasBolt = AssemblyCanvasCallout & {
  id: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  label: string;
  status?: 'pending' | 'current' | 'ok' | 'ng' | 'ignored';
};

export type AssemblyCanvasCheckItem = AssemblyCanvasCallout & {
  id: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  label: string | null;
  required: boolean;
  checked: boolean;
};

type Props = {
  imageRelativePath: string | null | undefined;
  bolts: AssemblyCanvasBolt[];
  checkItems?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  selectedCheckItemId?: string | null;
  onSelectBolt?: (id: string) => void;
  onSelectCheckItem?: (id: string) => void;
  onToggleCheckItem?: (id: string) => void;
  onAddBolt?: (xRatio: number, yRatio: number) => void;
  onAddCheckItem?: (xRatio: number, yRatio: number) => void;
  onPlaceCallout?: (xRatio: number, yRatio: number) => void;
  placementMode?: 'bolt' | 'check';
  placementAction?: 'place' | 'callout';
  zoom?: number;
  fitGeneration?: number;
  className?: string;
};

function boltMarkerClass(status: AssemblyCanvasBolt['status'], selected: boolean): string {
  if (selected) return 'bg-cyan-300 text-slate-950 ring-4 ring-cyan-100';
  if (status === 'current') return 'bg-amber-300 text-slate-950 ring-4 ring-amber-100';
  if (status === 'ok') return 'bg-emerald-500 text-white ring-2 ring-emerald-200';
  if (status === 'ng') return 'bg-rose-600 text-white ring-2 ring-rose-200';
  if (status === 'ignored') return 'bg-slate-500 text-white ring-2 ring-slate-200';
  return 'bg-white text-slate-950 ring-2 ring-slate-400';
}

function checkMarkerClass(item: AssemblyCanvasCheckItem, selected: boolean): string {
  if (selected) return 'bg-lime-200 text-slate-950 ring-4 ring-lime-100';
  if (item.checked) return 'bg-emerald-600 text-white ring-2 ring-emerald-300';
  if (item.required) return 'bg-lime-400 text-slate-950 ring-2 ring-lime-200';
  return 'bg-lime-300/80 text-slate-900 ring-2 ring-dashed ring-lime-100';
}

function assemblyCanvasCallouts(
  bolts: AssemblyCanvasBolt[],
  checkItems: AssemblyCanvasCheckItem[]
) {
  return [
    ...bolts.map((bolt) => ({ ...bolt, tone: 'amber' as const })),
    ...checkItems.map((item) => ({ ...item, tone: 'lime' as const }))
  ];
}

export function AssemblyMarkerOverlay({
  bolts,
  checkItems = [],
  selectedBoltId,
  selectedCheckItemId,
  onSelectBolt,
  onSelectCheckItem,
  onToggleCheckItem
}: Pick<
  Props,
  | 'bolts'
  | 'checkItems'
  | 'selectedBoltId'
  | 'selectedCheckItemId'
  | 'onSelectBolt'
  | 'onSelectCheckItem'
  | 'onToggleCheckItem'
>) {
  return (
    <>
      {bolts.map((bolt) => (
        <button
          key={`bolt-${bolt.id}`}
          type="button"
          title={bolt.label}
          aria-label={bolt.label}
          onClick={(event) => {
            event.stopPropagation();
            onSelectBolt?.(bolt.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={clsx(
            'absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold shadow-lg',
            boltMarkerClass(bolt.status, selectedBoltId === bolt.id)
          )}
          style={{ left: `${bolt.xRatio * 100}%`, top: `${bolt.yRatio * 100}%` }}
        >
          {bolt.markerNo}
        </button>
      ))}
      {checkItems.map((item) => (
        <button
          key={`check-${item.id}`}
          type="button"
          title={item.label ?? `チェック${item.markerNo}`}
          aria-label={item.label ?? `チェック${item.markerNo}`}
          onClick={(event) => {
            event.stopPropagation();
            if (onToggleCheckItem) {
              onToggleCheckItem(item.id);
              return;
            }
            onSelectCheckItem?.(item.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className={clsx(
            'absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-bold shadow-lg',
            checkMarkerClass(item, selectedCheckItemId === item.id)
          )}
          style={{ left: `${item.xRatio * 100}%`, top: `${item.yRatio * 100}%` }}
        >
          ✓{item.markerNo}
        </button>
      ))}
    </>
  );
}

function useContainFitBox(
  viewportRef: RefObject<HTMLElement | null>,
  naturalWidth: number,
  naturalHeight: number
): { width: number; height: number } {
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setBox(computeContainSize(rect.width, rect.height, naturalWidth, naturalHeight));
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewportRef, naturalWidth, naturalHeight]);

  return box;
}

function useElementSize(elementRef: RefObject<HTMLElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef]);

  return size;
}

function zeroOffsetLayout(width: number, height: number): ZoomedImageCanvasLayout | null {
  if (width <= 0 || height <= 0) return null;
  return {
    image: { offsetX: 0, offsetY: 0, width, height },
    contentWidth: width,
    contentHeight: height
  };
}

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
  selectedCheckItemId,
  onSelectBolt,
  onSelectCheckItem,
  onToggleCheckItem,
  onAddBolt,
  onAddCheckItem,
  onPlaceCallout,
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
  } | null>(null);
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
    if (event.button !== 0 || !placementHandler || !layout) return;
    pendingPointerRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      maxMovementPx: 0
    };
    viewportRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    pending.maxMovementPx = Math.max(
      pending.maxMovementPx,
      Math.hypot(event.clientX - pending.startClientX, event.clientY - pending.startClientY)
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pending = pendingPointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const maxMovementPx = pending.maxMovementPx;
    clearPendingPointer(event.pointerId);
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
            <ImageMarkerCalloutOverlay
              items={assemblyCanvasCallouts(bolts, checkItems)}
              selectedId={selectedBoltId ?? selectedCheckItemId}
              layout={layout}
            />
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
              <AssemblyMarkerOverlay
                bolts={bolts}
                checkItems={checkItems}
                selectedBoltId={selectedBoltId}
                selectedCheckItemId={selectedCheckItemId}
                onSelectBolt={onSelectBolt}
                onSelectCheckItem={onSelectCheckItem}
                onToggleCheckItem={onToggleCheckItem}
              />
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
  selectedCheckItemId,
  onSelectBolt,
  onSelectCheckItem,
  onToggleCheckItem,
  onPlacementClick,
  fitToParent = false,
  className
}: {
  imageContent: ReactNode;
  bolts: AssemblyCanvasBolt[];
  checkItems?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  selectedCheckItemId?: string | null;
  onSelectBolt?: (id: string) => void;
  onSelectCheckItem?: (id: string) => void;
  onToggleCheckItem?: (id: string) => void;
  onPlacementClick?: (xRatio: number, yRatio: number) => void;
  /** When true, scale the image to the largest size that fits the parent while preserving aspect ratio. */
  fitToParent?: boolean;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const natural = useNaturalSizeFromImg(fitToParent ? viewportRef : frameRef, [imageContent, fitToParent]);
  const fitted = useContainFitBox(viewportRef, natural.width, natural.height);
  const frameSize = useElementSize(frameRef);
  const calloutLayout = zeroOffsetLayout(frameSize.width, frameSize.height);

  const markerLayers = (
    <>
      {calloutLayout ? (
        <ImageMarkerCalloutOverlay
          items={assemblyCanvasCallouts(bolts, checkItems)}
          selectedId={selectedBoltId ?? selectedCheckItemId}
          layout={calloutLayout}
        />
      ) : null}
      <AssemblyMarkerOverlay
        bolts={bolts}
        checkItems={checkItems}
        selectedBoltId={selectedBoltId}
        selectedCheckItemId={selectedCheckItemId}
        onSelectBolt={onSelectBolt}
        onSelectCheckItem={onSelectCheckItem}
        onToggleCheckItem={onToggleCheckItem}
      />
    </>
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
        {markerLayers}
      </div>
    </div>
  );
}
