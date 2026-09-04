import clsx from 'clsx';
import { useLayoutEffect, useRef, useState } from 'react';

import {
  clampImageMarkerRatio,
  ImageMarkerCalloutOverlay,
  shouldConfirmImageCanvasTap
} from '../kiosk/image-canvas';
import {
  KIOSK_MARKER_STATUS_CLASS,
  kioskMarkerInputTargetOutlineClass,
  type KioskMarkerStatus
} from '../kiosk/kioskMarkerTheme';

import type { ZoomedImageCanvasLayout } from '../kiosk/image-canvas';
import type { PointerEvent as ReactPointerEvent } from 'react';

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

export type AssemblyProcedureMarkerPoint = {
  xRatio: number;
  yRatio: number;
};

export type AssemblyProcedureBoltMoveHandler = (
  id: string,
  point: AssemblyProcedureMarkerPoint
) => void;

export type AssemblyProcedureCheckMoveHandler = AssemblyProcedureBoltMoveHandler;

export type AssemblyProcedureMarkerLayerProps = {
  bolts: AssemblyCanvasBolt[];
  checkItems?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  inputTargetBoltId?: string | null;
  selectedCheckItemId?: string | null;
  onSelectBolt?: (id: string) => void;
  onMoveBolt?: AssemblyProcedureBoltMoveHandler;
  onSelectCheckItem?: (id: string) => void;
  onMoveCheckItem?: AssemblyProcedureCheckMoveHandler;
  onToggleCheckItem?: (id: string) => void;
  density?: 'default' | 'compact';
  layoutSize?: { width: number; height: number };
};

function boltMarkerClass(status: AssemblyCanvasBolt['status'], selected: boolean): string {
  if (selected) return 'bg-cyan-300 text-slate-950 ring-4 ring-cyan-100';
  const markerStatus: KioskMarkerStatus =
    status === 'ok' ? 'ok' : status === 'ng' ? 'ng' : 'pending';
  return KIOSK_MARKER_STATUS_CLASS[markerStatus];
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

function zeroOffsetLayout(width: number, height: number): ZoomedImageCanvasLayout | null {
  if (width <= 0 || height <= 0) return null;
  return {
    image: { offsetX: 0, offsetY: 0, width, height },
    contentWidth: width,
    contentHeight: height
  };
}

type MarkerPointerInteraction = {
  markerId: string;
  onMove?: AssemblyProcedureBoltMoveHandler;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  maxMovementPx: number;
  dragging: boolean;
  captureTarget: HTMLButtonElement;
  originalStyle: {
    left: string;
    top: string;
  };
  pendingPoint: AssemblyProcedureMarkerPoint | null;
  animationFrameId: number | null;
};

function markerPointFromPointer(
  event: Pick<ReactPointerEvent<HTMLButtonElement>, 'clientX' | 'clientY'>,
  target: HTMLElement | null
): AssemblyProcedureMarkerPoint | null {
  const rect = target?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    xRatio: clampImageMarkerRatio((event.clientX - rect.left) / rect.width),
    yRatio: clampImageMarkerRatio((event.clientY - rect.top) / rect.height)
  };
}

function setMarkerPosition(
  target: HTMLElement,
  point: AssemblyProcedureMarkerPoint
): void {
  target.style.left = `${point.xRatio * 100}%`;
  target.style.top = `${point.yRatio * 100}%`;
}

function releasePointerCapture(interaction: MarkerPointerInteraction): void {
  if (!interaction.captureTarget.releasePointerCapture) return;
  try {
    interaction.captureTarget.releasePointerCapture(interaction.pointerId);
  } catch {
    // Pointer capture may already have been released by the browser.
  }
}

function cancelMarkerAnimationFrame(interaction: MarkerPointerInteraction): void {
  if (interaction.animationFrameId == null) return;
  cancelAnimationFrame(interaction.animationFrameId);
  interaction.animationFrameId = null;
}

export function AssemblyMarkerOverlay({
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
  density = 'default'
}: AssemblyProcedureMarkerLayerProps) {
  const markerPointerRef = useRef<MarkerPointerInteraction | null>(null);

  useLayoutEffect(() => {
    return () => {
      const interaction = markerPointerRef.current;
      if (!interaction) return;
      cancelMarkerAnimationFrame(interaction);
      releasePointerCapture(interaction);
      markerPointerRef.current = null;
    };
  }, []);

  const handleMarkerPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    markerId: string,
    onMove?: AssemblyProcedureBoltMoveHandler
  ) => {
    event.stopPropagation();
    if (event.button != null && event.button !== 0) return;
    const target = event.currentTarget;
    markerPointerRef.current = {
      markerId,
      onMove,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      maxMovementPx: 0,
      dragging: false,
      captureTarget: target,
      originalStyle: {
        left: target.style.left,
        top: target.style.top
      },
      pendingPoint: null,
      animationFrameId: null
    };
    target.setPointerCapture?.(event.pointerId);
  };

  const handleMarkerPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const interaction = markerPointerRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.stopPropagation();
    interaction.maxMovementPx = Math.max(
      interaction.maxMovementPx,
      Math.hypot(
        event.clientX - interaction.startClientX,
        event.clientY - interaction.startClientY
      )
    );
    if (shouldConfirmImageCanvasTap(interaction.maxMovementPx)) return;

    interaction.dragging = true;
    const point = markerPointFromPointer(event, event.currentTarget.parentElement);
    if (!point) return;
    interaction.pendingPoint = point;
    event.preventDefault();
    if (interaction.animationFrameId != null) return;
    interaction.animationFrameId = requestAnimationFrame(() => {
      const current = markerPointerRef.current;
      if (current !== interaction) return;
      current.animationFrameId = null;
      if (current.dragging && current.pendingPoint) {
        setMarkerPosition(current.captureTarget, current.pendingPoint);
      }
    });
  };

  const endMarkerPointerInteraction = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled: boolean
  ) => {
    const interaction = markerPointerRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.stopPropagation();
    interaction.maxMovementPx = Math.max(
      interaction.maxMovementPx,
      Math.hypot(
        event.clientX - interaction.startClientX,
        event.clientY - interaction.startClientY
      )
    );
    if (!cancelled) {
      interaction.dragging = !shouldConfirmImageCanvasTap(interaction.maxMovementPx);
    }
    const point = markerPointFromPointer(event, event.currentTarget.parentElement);
    cancelMarkerAnimationFrame(interaction);
    if (cancelled) {
      interaction.captureTarget.style.left = interaction.originalStyle.left;
      interaction.captureTarget.style.top = interaction.originalStyle.top;
    } else if (!cancelled && interaction.dragging && point) {
      event.preventDefault();
      setMarkerPosition(interaction.captureTarget, point);
      interaction.onMove?.(interaction.markerId, point);
    }
    markerPointerRef.current = null;
    releasePointerCapture(interaction);
  };

  if (density === 'compact') {
    return (
      <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
        {bolts.map((bolt) => (
          <span
            key={`bolt-${bolt.id}`}
            data-marker-id={bolt.id}
            className={clsx(
              'absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[0.48rem] font-bold shadow',
              boltMarkerClass(bolt.status, false),
              inputTargetBoltId === bolt.id &&
                'outline outline-2 outline-offset-1 outline-sky-400'
            )}
            style={{ left: `${bolt.xRatio * 100}%`, top: `${bolt.yRatio * 100}%` }}
          >
            {bolt.markerNo}
          </span>
        ))}
        {checkItems.map((item) => (
          <span
            key={`check-${item.id}`}
            data-marker-id={item.id}
            className={clsx(
              'absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[0.42rem] font-bold shadow',
              checkMarkerClass(item, false)
            )}
            style={{ left: `${item.xRatio * 100}%`, top: `${item.yRatio * 100}%` }}
          >
            ✓{item.markerNo}
          </span>
        ))}
      </div>
    );
  }

  return (
    <>
      {bolts.map((bolt) => (
        <button
          key={`bolt-${bolt.id}`}
          type="button"
          title={bolt.label}
          aria-label={bolt.label}
          data-marker-id={bolt.id}
          onClick={(event) => {
            event.stopPropagation();
            onSelectBolt?.(bolt.id);
          }}
          onPointerDown={onMoveBolt ? (event) => handleMarkerPointerDown(event, bolt.id, onMoveBolt) : undefined}
          onPointerMove={onMoveBolt ? handleMarkerPointerMove : undefined}
          onPointerUp={onMoveBolt ? (event) => endMarkerPointerInteraction(event, false) : undefined}
          onPointerCancel={onMoveBolt ? (event) => endMarkerPointerInteraction(event, true) : undefined}
          className={clsx(
            'absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold shadow-lg',
            boltMarkerClass(bolt.status, selectedBoltId === bolt.id),
            kioskMarkerInputTargetOutlineClass(inputTargetBoltId === bolt.id),
            onMoveBolt && 'touch-none cursor-move'
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
          data-marker-id={item.id}
          onClick={(event) => {
            event.stopPropagation();
            if (onToggleCheckItem) {
              onToggleCheckItem(item.id);
              return;
            }
            onSelectCheckItem?.(item.id);
          }}
          onPointerDown={onMoveCheckItem ? (event) => handleMarkerPointerDown(event, item.id, onMoveCheckItem) : (event) => event.stopPropagation()}
          onPointerMove={onMoveCheckItem ? handleMarkerPointerMove : undefined}
          onPointerUp={onMoveCheckItem ? (event) => endMarkerPointerInteraction(event, false) : undefined}
          onPointerCancel={onMoveCheckItem ? (event) => endMarkerPointerInteraction(event, true) : undefined}
          className={clsx(
            'absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-bold shadow-lg',
            checkMarkerClass(item, selectedCheckItemId === item.id),
            onMoveCheckItem && 'touch-none cursor-move'
          )}
          style={{ left: `${item.xRatio * 100}%`, top: `${item.yRatio * 100}%` }}
        >
          ✓{item.markerNo}
        </button>
      ))}
    </>
  );
}

export function AssemblyProcedureMarkerLayer({
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
  density = 'default',
  layoutSize
}: AssemblyProcedureMarkerLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 &&
        Math.abs(current.height - rect.height) < 0.5
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
  }, []);

  const calloutLayout = zeroOffsetLayout(
    layoutSize?.width ?? size.width,
    layoutSize?.height ?? size.height
  );

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      data-testid={`assembly-procedure-marker-layer-${density}`}
    >
      {calloutLayout ? (
        <ImageMarkerCalloutOverlay
          items={assemblyCanvasCallouts(bolts, checkItems)}
          selectedId={selectedBoltId ?? selectedCheckItemId}
          layout={calloutLayout}
          density={density}
        />
      ) : null}
      <AssemblyMarkerOverlay
        bolts={bolts}
        checkItems={checkItems}
        selectedBoltId={selectedBoltId}
        inputTargetBoltId={inputTargetBoltId}
        selectedCheckItemId={selectedCheckItemId}
        onSelectBolt={onSelectBolt}
        onMoveBolt={onMoveBolt}
        onMoveCheckItem={onMoveCheckItem}
        onSelectCheckItem={onSelectCheckItem}
        onToggleCheckItem={onToggleCheckItem}
        density={density}
      />
    </div>
  );
}
