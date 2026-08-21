import {
  projectAssemblyProcedureOverlayBBoxFromCrop,
  type AssemblyProcedureCropRect,
  type AssemblyProcedureOverlayBBox,
  type AssemblyProcedureOverlayElement
} from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useRef, useState } from 'react';

import { AssemblyProcedureCanvas } from '../AssemblyProcedureCanvas';
import { AssemblyProcedureCropView } from '../AssemblyProcedureCropView';
import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';

import type { AssemblyProcedureOverlayAssetDto } from '../types';
import type { PointerEvent as ReactPointerEvent } from 'react';

type RangeSurfaceProps = {
  selectionMode: boolean;
  pageIndex: number;
  crop?: AssemblyProcedureCropRect | null;
  onRangeSelected: (bbox: AssemblyProcedureOverlayBBox) => void;
};

function pointInSurface(event: ReactPointerEvent<HTMLDivElement>): { xRatio: number; yRatio: number } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function normalizeBBox(start: { xRatio: number; yRatio: number }, end: { xRatio: number; yRatio: number }): AssemblyProcedureOverlayBBox {
  return {
    xRatio: Math.min(start.xRatio, end.xRatio),
    yRatio: Math.min(start.yRatio, end.yRatio),
    widthRatio: Math.abs(end.xRatio - start.xRatio),
    heightRatio: Math.abs(end.yRatio - start.yRatio)
  };
}

function OverlayRangeSelectionSurface({ selectionMode, pageIndex, crop, onRangeSelected }: RangeSurfaceProps) {
  const pointerRef = useRef<{ pointerId: number; start: { xRatio: number; yRatio: number } } | null>(null);
  const [preview, setPreview] = useState<AssemblyProcedureOverlayBBox | null>(null);

  if (!selectionMode) return null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const start = pointInSurface(event);
    if (!start) return;
    event.stopPropagation();
    event.preventDefault();
    pointerRef.current = { pointerId: event.pointerId, start };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview({ xRatio: start.xRatio, yRatio: start.yRatio, widthRatio: 0, heightRatio: 0 });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = pointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const end = pointInSurface(event);
    if (!end) return;
    event.stopPropagation();
    event.preventDefault();
    setPreview(normalizeBBox(pending.start, end));
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = pointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const end = pointInSurface(event);
    pointerRef.current = null;
    setPreview(null);
    event.stopPropagation();
    event.preventDefault();
    if (!end) return;
    const local = normalizeBBox(pending.start, end);
    if (local.widthRatio < 0.01 || local.heightRatio < 0.01) return;
    onRangeSelected(crop ? projectAssemblyProcedureOverlayBBoxFromCrop(local, crop) : local);
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 cursor-crosshair touch-none"
      aria-label="オーバーレイ範囲選択面"
      role="application"
      tabIndex={0}
      data-kiosk-sop-target="assembly-document-editor-range-surface"
      data-page-index={pageIndex}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {preview && preview.widthRatio > 0 && preview.heightRatio > 0 ? (
        <div
          className="pointer-events-none absolute border-2 border-amber-300 bg-amber-300/20"
          style={{
            left: `${preview.xRatio * 100}%`,
            top: `${preview.yRatio * 100}%`,
            width: `${preview.widthRatio * 100}%`,
            height: `${preview.heightRatio * 100}%`
          }}
          data-testid="assembly-document-editor-pending-range"
        />
      ) : null}
    </div>
  );
}

export function AssemblyProcedureDocumentEditorCanvas({
  pageUrl,
  pageIndex,
  crop,
  elements,
  selectionMode,
  selectedOverlayId,
  onSelectOverlay,
  onNudgeOverlay,
  onRangeSelected,
  assets,
  className
}: {
  pageUrl: string;
  pageIndex: number;
  crop?: AssemblyProcedureCropRect | null;
  elements: AssemblyProcedureOverlayElement[];
  selectionMode: boolean;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string) => void;
  onNudgeOverlay: (id: string, dxRatio: number, dyRatio: number) => void;
  onRangeSelected: (bbox: AssemblyProcedureOverlayBBox) => void;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  className?: string;
}) {
  const overlay = (
    <div className="absolute inset-0">
      <AssemblyProcedureOverlayLayer
        elements={elements}
        crop={crop}
        selectedOverlayId={selectedOverlayId}
        interactive={!selectionMode}
        onSelect={onSelectOverlay}
        onNudge={onNudgeOverlay}
        assets={assets}
      />
      <OverlayRangeSelectionSurface
        selectionMode={selectionMode}
        pageIndex={pageIndex}
        crop={crop}
        onRangeSelected={onRangeSelected}
      />
    </div>
  );

  if (crop) {
    return (
      <AssemblyProcedureCropView
        pageUrl={pageUrl}
        crop={crop}
        className={clsx('h-full w-full', className)}
        overlay={overlay}
      />
    );
  }

  return (
    <AssemblyProcedureCanvas
      imageRelativePath={pageUrl}
      bolts={[]}
      checkItems={[]}
      placementAction="place"
      overlay={overlay}
      className={clsx('h-full w-full', className)}
    />
  );
}
