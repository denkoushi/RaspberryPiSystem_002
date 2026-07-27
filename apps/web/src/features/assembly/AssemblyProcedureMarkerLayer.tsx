import clsx from 'clsx';
import { useLayoutEffect, useRef, useState } from 'react';

import { ImageMarkerCalloutOverlay } from '../kiosk/image-canvas';
import {
  KIOSK_MARKER_STATUS_CLASS,
  kioskMarkerInputTargetOutlineClass,
  type KioskMarkerStatus
} from '../kiosk/kioskMarkerTheme';

import type { ZoomedImageCanvasLayout } from '../kiosk/image-canvas';

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

export type AssemblyProcedureMarkerLayerProps = {
  bolts: AssemblyCanvasBolt[];
  checkItems?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  inputTargetBoltId?: string | null;
  selectedCheckItemId?: string | null;
  onSelectBolt?: (id: string) => void;
  onSelectCheckItem?: (id: string) => void;
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

export function AssemblyMarkerOverlay({
  bolts,
  checkItems = [],
  selectedBoltId,
  inputTargetBoltId,
  selectedCheckItemId,
  onSelectBolt,
  onSelectCheckItem,
  onToggleCheckItem,
  density = 'default'
}: AssemblyProcedureMarkerLayerProps) {
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
          onPointerDown={(event) => event.stopPropagation()}
          className={clsx(
            'absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold shadow-lg',
            boltMarkerClass(bolt.status, selectedBoltId === bolt.id),
            kioskMarkerInputTargetOutlineClass(inputTargetBoltId === bolt.id)
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

export function AssemblyProcedureMarkerLayer({
  bolts,
  checkItems = [],
  selectedBoltId,
  inputTargetBoltId,
  selectedCheckItemId,
  onSelectBolt,
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
        onSelectCheckItem={onSelectCheckItem}
        onToggleCheckItem={onToggleCheckItem}
        density={density}
      />
    </div>
  );
}
