import clsx from 'clsx';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { ImageOverlayFrame } from '../overlays/ImageOverlayFrame';

import { normalizeWorkInstructionOverlayBBox } from './workInstructionEditorDraft';

import type { WorkInstructionEditorStepDto } from '../../api/domains/work-instruction-overlays';
import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';
import type { OverlayBBox } from '@raspi-system/shared-types';

function pointInSurface(event: ReactPointerEvent<HTMLDivElement>): { xRatio: number; yRatio: number } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function rangeBetween(start: { xRatio: number; yRatio: number }, end: { xRatio: number; yRatio: number }): OverlayBBox {
  return normalizeWorkInstructionOverlayBBox({
    xRatio: Math.min(start.xRatio, end.xRatio),
    yRatio: Math.min(start.yRatio, end.yRatio),
    widthRatio: Math.abs(end.xRatio - start.xRatio),
    heightRatio: Math.abs(end.yRatio - start.yRatio)
  });
}

function RangeSurface({
  enabled,
  onRangeSelected
}: {
  enabled: boolean;
  onRangeSelected: (bbox: OverlayBBox) => void;
}) {
  const pointerRef = useRef<{ pointerId: number; start: { xRatio: number; yRatio: number } } | null>(null);
  const [preview, setPreview] = useState<OverlayBBox | null>(null);
  if (!enabled) return null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const start = pointInSurface(event);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    pointerRef.current = { pointerId: event.pointerId, start };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview({ xRatio: start.xRatio, yRatio: start.yRatio, widthRatio: 0, heightRatio: 0 });
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = pointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const end = pointInSurface(event);
    if (!end) return;
    event.preventDefault();
    event.stopPropagation();
    setPreview(rangeBetween(pending.start, end));
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = pointerRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const end = pointInSurface(event);
    pointerRef.current = null;
    setPreview(null);
    event.preventDefault();
    event.stopPropagation();
    if (!end) return;
    const bbox = rangeBetween(pending.start, end);
    if (bbox.widthRatio < 0.01 || bbox.heightRatio < 0.01) return;
    onRangeSelected(bbox);
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 cursor-crosshair touch-none"
      role="application"
      tabIndex={0}
      aria-label="オーバーレイ範囲選択面"
      data-testid="work-instruction-editor-range-surface"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {preview && preview.widthRatio > 0 && preview.heightRatio > 0 ? (
        <div className="pointer-events-none absolute border-2 border-amber-300 bg-amber-300/20" style={{ left: `${preview.xRatio * 100}%`, top: `${preview.yRatio * 100}%`, width: `${preview.widthRatio * 100}%`, height: `${preview.heightRatio * 100}%` }} data-testid="work-instruction-editor-pending-range" />
      ) : null}
    </div>
  );
}

export function WorkInstructionEditorCanvas({
  step,
  elements,
  selectedOverlayId,
  selectionMode,
  editable,
  onSelectOverlay,
  onNudgeOverlay,
  onUpdateOverlayBBox,
  onRangeSelected,
  assets,
  className
}: {
  step: WorkInstructionEditorStepDto | null;
  elements: WorkInstructionOverlayElement[];
  selectedOverlayId: string | null;
  selectionMode: boolean;
  editable: boolean;
  onSelectOverlay: (id: string) => void;
  onNudgeOverlay: (id: string, dxRatio: number, dyRatio: number) => void;
  onUpdateOverlayBBox: (id: string, bbox: OverlayBBox) => void;
  onRangeSelected: (bbox: OverlayBBox) => void;
  assets?: Record<string, { assetId?: string; storageKey?: string; contentType?: string; byteSize?: number; sha256?: string; url?: string; relativeUrl?: string }>;
  className?: string;
}) {
  if (!step) {
    return <div className={clsx('flex min-h-0 items-center justify-center bg-slate-950 text-sm text-white/60', className)}>手順を選択してください</div>;
  }
  const imagePath = step.imageUrl ?? (step.imageAssetId ? `/api/work-instructions/assets/${encodeURIComponent(step.imageAssetId)}` : null);
  return (
    <ImageOverlayFrame
      imageUrl={imagePath}
      alt={`手順${step.step}の作業要領画像`}
      overlays={elements}
      assets={assets}
      selectedOverlayId={selectedOverlayId}
      interactive={editable && !selectionMode}
      onSelectOverlay={onSelectOverlay}
      onNudgeOverlay={onNudgeOverlay}
      onUpdateOverlayBBox={editable ? onUpdateOverlayBBox : undefined}
      className={clsx('h-full w-full', className)}
      testId="work-instruction-editor-canvas"
    >
      <RangeSurface enabled={editable && selectionMode} onRangeSelected={onRangeSelected} />
    </ImageOverlayFrame>
  );
}
