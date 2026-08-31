import {
  projectOverlayBBoxFromCrop,
  projectOverlayElementToCrop
} from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useRef } from 'react';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import type {
  OverlayBBox,
  OverlayCropRect,
  OverlayElement,
  OverlayPoint
} from '@raspi-system/shared-types';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

/**
 * Domain-neutral asset metadata. The API adapter may provide either an
 * authenticated relative URL or a resolved URL; the renderer never assumes
 * an Assembly storage prefix.
 */
export type OverlayAsset = {
  assetId?: string;
  id?: string;
  storageKey?: string;
  contentType?: string;
  byteSize?: number;
  sha256?: string;
  url?: string;
  relativeUrl?: string;
};

export type OverlayAssetMap = Record<string, OverlayAsset>;

export type OverlayLayerProps = {
  elements?: OverlayElement[];
  crop?: OverlayCropRect | null;
  selectedOverlayId?: string | null;
  interactive?: boolean;
  onSelect?: (id: string) => void;
  onNudge?: (id: string, dxRatio: number, dyRatio: number) => void;
  onUpdateBBox?: (id: string, bbox: OverlayBBox) => void;
  assets?: OverlayAssetMap;
  resolveAssetUrl?: (assetId: string, asset?: OverlayAsset) => string;
  className?: string;
  testId?: string;
  testIdPrefix?: string;
};

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
type PointerInteraction = {
  pointerId: number;
  mode: 'move' | 'resize';
  handle?: ResizeHandle;
  elementId: string;
  originalLocalBBox: OverlayBBox;
  startLocalPoint: OverlayPoint;
  captureTarget: HTMLElement;
  lastSourceBBox: OverlayBBox;
};

const MIN_INTERACTIVE_RATIO = 0.005;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeInteractiveBBox(
  bbox: OverlayBBox,
  minimumWidthRatio = MIN_INTERACTIVE_RATIO,
  minimumHeightRatio = MIN_INTERACTIVE_RATIO
): OverlayBBox {
  const widthRatio = Math.max(minimumWidthRatio, Math.min(1, finiteOr(bbox.widthRatio, minimumWidthRatio)));
  const heightRatio = Math.max(minimumHeightRatio, Math.min(1, finiteOr(bbox.heightRatio, minimumHeightRatio)));
  return {
    xRatio: Math.max(0, Math.min(1 - widthRatio, finiteOr(bbox.xRatio, 0))),
    yRatio: Math.max(0, Math.min(1 - heightRatio, finiteOr(bbox.yRatio, 0))),
    widthRatio,
    heightRatio
  };
}

function bboxBetweenPoints(
  start: OverlayPoint,
  end: OverlayPoint,
  minimumWidthRatio = MIN_INTERACTIVE_RATIO,
  minimumHeightRatio = MIN_INTERACTIVE_RATIO,
  clampToUnit = true
): OverlayBBox {
  const widthRatio = Math.max(minimumWidthRatio, Math.abs(end.xRatio - start.xRatio));
  const heightRatio = Math.max(minimumHeightRatio, Math.abs(end.yRatio - start.yRatio));
  const bbox = {
    xRatio: end.xRatio >= start.xRatio ? start.xRatio : start.xRatio - widthRatio,
    yRatio: end.yRatio >= start.yRatio ? start.yRatio : start.yRatio - heightRatio,
    widthRatio,
    heightRatio
  };
  return clampToUnit ? normalizeInteractiveBBox(bbox, minimumWidthRatio, minimumHeightRatio) : bbox;
}

function bboxEqual(left: OverlayBBox, right: OverlayBBox): boolean {
  return Math.abs(left.xRatio - right.xRatio) < 1e-9
    && Math.abs(left.yRatio - right.yRatio) < 1e-9
    && Math.abs(left.widthRatio - right.widthRatio) < 1e-9
    && Math.abs(left.heightRatio - right.heightRatio) < 1e-9;
}

function pointInLayer(event: ReactPointerEvent<HTMLElement>, layer: HTMLElement | null): OverlayPoint | null {
  if (!layer) return null;
  const rect = layer.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function sourceBBoxFromLocal(localBBox: OverlayBBox, crop?: OverlayCropRect | null): OverlayBBox {
  return normalizeInteractiveBBox(crop ? projectOverlayBBoxFromCrop(localBBox, crop) : localBBox);
}

function sourceBBoxToLocal(sourceBBox: OverlayBBox, crop?: OverlayCropRect | null): OverlayBBox {
  if (!crop) return sourceBBox;
  return {
    xRatio: (sourceBBox.xRatio - crop.xRatio) / Math.max(crop.widthRatio, Number.EPSILON),
    yRatio: (sourceBBox.yRatio - crop.yRatio) / Math.max(crop.heightRatio, Number.EPSILON),
    widthRatio: sourceBBox.widthRatio / Math.max(crop.widthRatio, Number.EPSILON),
    heightRatio: sourceBBox.heightRatio / Math.max(crop.heightRatio, Number.EPSILON)
  };
}

function minimumLocalRatio(crop: OverlayCropRect | null | undefined, axis: 'width' | 'height'): number {
  if (!crop) return MIN_INTERACTIVE_RATIO;
  const ratio = axis === 'width' ? crop.widthRatio : crop.heightRatio;
  return Math.min(1, MIN_INTERACTIVE_RATIO / Math.max(ratio, Number.EPSILON));
}

function projectPointToCrop(point: OverlayPoint | undefined, crop?: OverlayCropRect | null): OverlayPoint | undefined {
  if (!point || !crop || crop.widthRatio <= 0 || crop.heightRatio <= 0) return point;
  return {
    xRatio: (point.xRatio - crop.xRatio) / crop.widthRatio,
    yRatio: (point.yRatio - crop.yRatio) / crop.heightRatio
  };
}

function projectElement(element: OverlayElement, crop?: OverlayCropRect | null): OverlayElement | null {
  if (!crop) return element;
  const projected = projectOverlayElementToCrop(element, crop);
  if (!projected) return null;
  if (projected.kind !== 'SHAPE') return projected;
  return {
    ...projected,
    start: projectPointToCrop(element.kind === 'SHAPE' ? element.start : undefined, crop),
    end: projectPointToCrop(element.kind === 'SHAPE' ? element.end : undefined, crop)
  };
}

function defaultAssetUrl(assetId: string, asset?: OverlayAsset): string {
  if (asset?.url) return asset.url;
  if (asset?.relativeUrl) return asset.relativeUrl;
  if (assetId.startsWith('/') || assetId.startsWith('http://') || assetId.startsWith('https://') || assetId.startsWith('data:')) return assetId;
  return `/api/storage/overlay-assets/${encodeURIComponent(assetId)}`;
}

function elementLabel(element: OverlayElement): string {
  if (element.kind === 'TEXT') return `文章オーバーレイ: ${element.text.slice(0, 30)}`;
  if (element.kind === 'IMAGE') return `画像オーバーレイ: ${element.assetId || '未指定'}`;
  return `図形オーバーレイ: ${element.shape}`;
}

function shapePoints(element: Extract<OverlayElement, { kind: 'SHAPE' }>) {
  return {
    start: element.start ?? { xRatio: element.bbox.xRatio, yRatio: element.bbox.yRatio },
    end: element.end ?? { xRatio: element.bbox.xRatio + element.bbox.widthRatio, yRatio: element.bbox.yRatio + element.bbox.heightRatio }
  };
}

function pointToLocal(point: OverlayPoint, element: OverlayElement): OverlayPoint {
  return {
    xRatio: element.bbox.widthRatio > 0 ? (point.xRatio - element.bbox.xRatio) / element.bbox.widthRatio : 0,
    yRatio: element.bbox.heightRatio > 0 ? (point.yRatio - element.bbox.yRatio) / element.bbox.heightRatio : 0
  };
}

function ShapeContent({ element }: { element: Extract<OverlayElement, { kind: 'SHAPE' }> }) {
  const points = shapePoints(element);
  const start = pointToLocal(points.start, element);
  const end = pointToLocal(points.end, element);
  const stroke = element.strokeColor ?? '#0f172a';
  const fill = element.fillColor ?? 'transparent';
  const strokeWidth = Math.max(1, Math.min(20, (element.strokeWidthRatio ?? 0.01) * 100));
  const common = { stroke, strokeWidth, fill, vectorEffect: 'non-scaling-stroke' as const };
  if (element.shape === 'ELLIPSE') {
    return <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 1 1"><ellipse cx="0.5" cy="0.5" rx="0.48" ry="0.48" {...common} /></svg>;
  }
  if (element.shape === 'LINE' || element.shape === 'ARROW') {
    const markerId = `overlay-arrowhead-${element.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    return (
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-hidden" viewBox="0 0 1 1">
        {element.shape === 'ARROW' ? <defs><marker id={markerId} markerWidth="0.08" markerHeight="0.08" markerUnits="userSpaceOnUse" orient="auto" refX="0.075" refY="0.04" viewBox="0 0 0.08 0.08"><path d="M0 0 L0.08 0.04 L0 0.08 Z" fill={stroke} stroke="none" /></marker></defs> : null}
        <line x1={start.xRatio} y1={start.yRatio} x2={end.xRatio} y2={end.yRatio} {...common} markerEnd={element.shape === 'ARROW' ? `url(#${markerId})` : undefined} />
      </svg>
    );
  }
  return <span aria-hidden="true" className="absolute inset-0 rounded-sm" style={{ border: `${strokeWidth}px solid ${stroke}`, backgroundColor: fill }} />;
}

function ImageContent({ element, assets, resolveAssetUrl }: {
  element: Extract<OverlayElement, { kind: 'IMAGE' }>;
  assets?: OverlayAssetMap;
  resolveAssetUrl: (assetId: string, asset?: OverlayAsset) => string;
}) {
  const asset = assets?.[element.assetId];
  const source = element.assetId ? resolveAssetUrl(element.assetId, asset) : null;
  const { blobUrl, error } = useProtectedImageBlobUrl(source);
  if (!element.assetId) return <span className="flex h-full w-full items-center justify-center bg-slate-200/80 text-center text-[0.65rem] font-semibold text-slate-700">画像assetを指定</span>;
  if (error || !blobUrl) return <span className="flex h-full w-full items-center justify-center bg-slate-200/80 text-center text-[0.65rem] font-semibold text-slate-700">{error ? '画像の読み込みに失敗しました' : '画像を読み込み中…'}</span>;
  return <img src={blobUrl} alt="" className="h-full w-full" draggable={false} style={{ objectFit: element.objectFit ?? 'contain' }} />;
}

function OverlayContent({ element, assets, resolveAssetUrl }: {
  element: OverlayElement;
  assets?: OverlayAssetMap;
  resolveAssetUrl: (assetId: string, asset?: OverlayAsset) => string;
}): ReactNode {
  if (element.kind === 'TEXT') {
    const style: CSSProperties = {
      color: element.style?.color ?? '#0f172a',
      fontFamily: element.style?.fontFamily,
      fontSize: `${Math.max(0.005, element.style?.fontSizeRatio ?? 0.025) * 100}cqw`,
      fontWeight: element.style?.fontWeight ?? 'normal',
      textAlign: element.style?.align === 'center' ? 'center' : element.style?.align === 'end' ? 'right' : 'left'
    };
    return <span className="block h-full w-full whitespace-pre-wrap break-words" style={style}>{element.text}</span>;
  }
  if (element.kind === 'IMAGE') return <ImageContent element={element} assets={assets} resolveAssetUrl={resolveAssetUrl} />;
  return <ShapeContent element={element} />;
}

/** Render and (when requested) move/resize overlays in source-image ratios. */
export function OverlayLayer({
  elements = [],
  crop,
  selectedOverlayId,
  interactive = false,
  onSelect,
  onNudge,
  onUpdateBBox,
  assets,
  resolveAssetUrl = defaultAssetUrl,
  className,
  testId = 'overlay-layer',
  testIdPrefix = 'overlay'
}: OverlayLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<PointerInteraction | null>(null);
  const projected = elements
    .map((source) => {
      const element = projectElement(source, crop);
      return element ? { source, element } : null;
    })
    .filter((entry): entry is { source: OverlayElement; element: OverlayElement } => entry != null)
    .sort((left, right) => left.element.zIndex - right.element.zIndex);

  const applyPointerInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = pointerRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const point = pointInLayer(event, layerRef.current);
    if (!point) return;
    const minWidth = minimumLocalRatio(crop, 'width');
    const minHeight = minimumLocalRatio(crop, 'height');
    let localBBox: OverlayBBox;
    if (interaction.mode === 'move') {
      localBBox = {
        ...interaction.originalLocalBBox,
        xRatio: interaction.originalLocalBBox.xRatio + point.xRatio - interaction.startLocalPoint.xRatio,
        yRatio: interaction.originalLocalBBox.yRatio + point.yRatio - interaction.startLocalPoint.yRatio
      };
    } else {
      if (!interaction.handle) return;
      const opposite = {
        xRatio: interaction.handle.includes('w') ? interaction.originalLocalBBox.xRatio + interaction.originalLocalBBox.widthRatio : interaction.originalLocalBBox.xRatio,
        yRatio: interaction.handle.includes('n') ? interaction.originalLocalBBox.yRatio + interaction.originalLocalBBox.heightRatio : interaction.originalLocalBBox.yRatio
      };
      localBBox = bboxBetweenPoints(opposite, point, minWidth, minHeight, false);
    }
    const sourceBBox = sourceBBoxFromLocal(localBBox, crop);
    event.stopPropagation();
    event.preventDefault();
    if (bboxEqual(sourceBBox, interaction.lastSourceBBox)) return;
    interaction.lastSourceBBox = sourceBBox;
    onUpdateBBox?.(interaction.elementId, sourceBBox);
  };

  const beginPointerInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    source: OverlayElement,
    mode: PointerInteraction['mode'],
    handle?: ResizeHandle
  ) => {
    if (!interactive || !onUpdateBBox || (event.button != null && event.button !== 0)) return;
    const startLocalPoint = pointInLayer(event, layerRef.current);
    if (!startLocalPoint) return;
    event.stopPropagation();
    event.preventDefault();
    const captureTarget = event.currentTarget;
    captureTarget.setPointerCapture?.(event.pointerId);
    pointerRef.current = {
      pointerId: event.pointerId,
      mode,
      handle,
      elementId: source.id,
      originalLocalBBox: sourceBBoxToLocal(source.bbox, crop),
      startLocalPoint,
      captureTarget,
      lastSourceBBox: source.bbox
    };
    onSelect?.(source.id);
  };

  const endPointerInteraction = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const interaction = pointerRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (!cancelled) applyPointerInteraction(event);
    pointerRef.current = null;
    if (interaction.captureTarget.hasPointerCapture?.(interaction.pointerId)) interaction.captureTarget.releasePointerCapture?.(interaction.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };

  return (
    <div ref={layerRef} className={clsx('pointer-events-none absolute inset-0 overflow-hidden', className)} data-testid={testId} style={{ containerType: 'inline-size' } as CSSProperties}>
      {projected.map(({ source, element }) => {
        const selected = selectedOverlayId === element.id;
        const transformable = interactive && Boolean(onUpdateBBox) && selected;
        const style: CSSProperties = {
          left: `${element.bbox.xRatio * 100}%`,
          top: `${element.bbox.yRatio * 100}%`,
          width: `${element.bbox.widthRatio * 100}%`,
          height: `${element.bbox.heightRatio * 100}%`,
          opacity: element.opacity ?? 1,
          zIndex: element.zIndex,
          backgroundColor: element.mask?.enabled ? element.mask.color : undefined
        };
        return (
          <span key={element.id}>
            <div
              className={clsx('absolute overflow-hidden p-0.5', interactive ? 'pointer-events-auto cursor-pointer rounded-sm' : 'pointer-events-none', transformable && 'touch-none cursor-move', selected && 'outline outline-2 outline-cyan-400 outline-offset-1')}
              style={style}
              data-overlay-id={element.id}
              data-testid={`${testIdPrefix}-${element.id}`}
              aria-label={interactive ? elementLabel(element) : undefined}
              aria-pressed={interactive ? selected : undefined}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? (event) => { event.stopPropagation(); onSelect?.(element.id); } : undefined}
              onPointerDown={interactive && onUpdateBBox ? (event) => beginPointerInteraction(event, source, 'move') : undefined}
              onPointerMove={interactive && onUpdateBBox ? applyPointerInteraction : undefined}
              onPointerUp={interactive && onUpdateBBox ? endPointerInteraction : undefined}
              onPointerCancel={interactive && onUpdateBBox ? (event) => endPointerInteraction(event, true) : undefined}
              onKeyDown={interactive ? (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(element.id); }
                  return;
                }
                event.preventDefault();
                const step = event.shiftKey ? 0.02 : 0.005;
                onNudge?.(element.id, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
              } : undefined}
            >
              <OverlayContent element={element} assets={assets} resolveAssetUrl={resolveAssetUrl} />
            </div>
            {transformable ? (['nw', 'ne', 'sw', 'se'] as const).map((handle) => {
              const label = { nw: '左上', ne: '右上', sw: '左下', se: '右下' }[handle];
              return (
                <button
                  key={handle}
                  type="button"
                  aria-label={`${elementLabel(source)} ${label}リサイズハンドル`}
                  className={clsx('pointer-events-auto absolute h-6 w-6 touch-none rounded-full border-2 border-slate-950 bg-cyan-300 p-0', handle === 'nw' || handle === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize')}
                  style={{ left: `${(element.bbox.xRatio + (handle.includes('w') ? 0 : element.bbox.widthRatio)) * 100}%`, top: `${(element.bbox.yRatio + (handle.includes('n') ? 0 : element.bbox.heightRatio)) * 100}%`, transform: 'translate(-50%, -50%)', zIndex: 1_000_000 }}
                  data-testid={`${testIdPrefix}-${element.id}-resize-${handle}`}
                  onPointerDown={(event) => beginPointerInteraction(event, source, 'resize', handle)}
                  onPointerMove={applyPointerInteraction}
                  onPointerUp={endPointerInteraction}
                  onPointerCancel={(event) => endPointerInteraction(event, true)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const step = event.shiftKey ? 0.02 : 0.005;
                    const sourceBBox = source.bbox;
                    const corner = {
                      xRatio: sourceBBox.xRatio + (handle.includes('w') ? 0 : sourceBBox.widthRatio),
                      yRatio: sourceBBox.yRatio + (handle.includes('n') ? 0 : sourceBBox.heightRatio)
                    };
                    const opposite = {
                      xRatio: sourceBBox.xRatio + (handle.includes('w') ? sourceBBox.widthRatio : 0),
                      yRatio: sourceBBox.yRatio + (handle.includes('n') ? sourceBBox.heightRatio : 0)
                    };
                    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
                    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
                    onUpdateBBox?.(source.id, bboxBetweenPoints(opposite, { xRatio: Math.max(0, Math.min(1, corner.xRatio + dx)), yRatio: Math.max(0, Math.min(1, corner.yRatio + dy)) }));
                  }}
                />
              );
            }) : null}
          </span>
        );
      })}
    </div>
  );
}

export function overlayElementLabel(element: OverlayElement): string {
  return elementLabel(element);
}
