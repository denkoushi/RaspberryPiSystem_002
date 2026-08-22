import {
  projectAssemblyProcedureOverlayElementToCrop,
  type AssemblyProcedureCropRect,
  type AssemblyProcedureOverlayElement,
  type AssemblyProcedurePoint
} from '@raspi-system/shared-types';
import clsx from 'clsx';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import type { AssemblyProcedureOverlayAssetDto } from './types';
import type { CSSProperties, ReactNode } from 'react';

type Props = {
  elements?: AssemblyProcedureOverlayElement[];
  crop?: AssemblyProcedureCropRect | null;
  selectedOverlayId?: string | null;
  interactive?: boolean;
  onSelect?: (id: string) => void;
  onNudge?: (id: string, dxRatio: number, dyRatio: number) => void;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
  className?: string;
};

type RenderElement = AssemblyProcedureOverlayElement;

function projectPointToCrop(
  point: AssemblyProcedurePoint | undefined,
  crop: AssemblyProcedureCropRect | null | undefined
): AssemblyProcedurePoint | undefined {
  if (!point || !crop || crop.widthRatio <= 0 || crop.heightRatio <= 0) return point;
  return {
    xRatio: (point.xRatio - crop.xRatio) / crop.widthRatio,
    yRatio: (point.yRatio - crop.yRatio) / crop.heightRatio
  };
}

function projectElement(
  element: AssemblyProcedureOverlayElement,
  crop: AssemblyProcedureCropRect | null | undefined
): RenderElement | null {
  if (!crop) return element;
  const projected = projectAssemblyProcedureOverlayElementToCrop(element, crop);
  if (!projected) return null;
  if (projected.kind !== 'SHAPE') return projected;
  const sourceShape = element.kind === 'SHAPE' ? element : projected;
  return {
    ...projected,
    start: projectPointToCrop(sourceShape.start, crop),
    end: projectPointToCrop(sourceShape.end, crop)
  };
}

function imageSource(
  assetId: string,
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>
): string {
  const value = assetId.trim();
  const asset = assets?.[value];
  if (asset?.url) return asset.url;
  if (asset?.relativeUrl) return asset.relativeUrl;
  if (value.startsWith('/') || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
    return value;
  }
  return `/api/storage/assembly-procedure-assets/${encodeURIComponent(value)}`;
}

function elementLabel(element: AssemblyProcedureOverlayElement): string {
  if (element.kind === 'TEXT') return `文章オーバーレイ: ${element.text.slice(0, 30)}`;
  if (element.kind === 'IMAGE') return `画像オーバーレイ: ${element.assetId || '未指定'}`;
  return `図形オーバーレイ: ${element.shape}`;
}

function shapeFallbackPoints(
  element: Extract<AssemblyProcedureOverlayElement, { kind: 'SHAPE' }>
): { start: AssemblyProcedurePoint; end: AssemblyProcedurePoint } {
  return {
    start: element.start ?? { xRatio: element.bbox.xRatio, yRatio: element.bbox.yRatio },
    end:
      element.end ?? {
        xRatio: element.bbox.xRatio + element.bbox.widthRatio,
        yRatio: element.bbox.yRatio + element.bbox.heightRatio
      }
  };
}

function pointToLocal(point: AssemblyProcedurePoint, element: RenderElement): AssemblyProcedurePoint {
  return {
    xRatio: element.bbox.widthRatio > 0 ? (point.xRatio - element.bbox.xRatio) / element.bbox.widthRatio : 0,
    yRatio: element.bbox.heightRatio > 0 ? (point.yRatio - element.bbox.yRatio) / element.bbox.heightRatio : 0
  };
}

function ShapeContent({ element }: { element: Extract<RenderElement, { kind: 'SHAPE' }> }) {
  const points = shapeFallbackPoints(element);
  const start = pointToLocal(points.start, element);
  const end = pointToLocal(points.end, element);
  const stroke = element.strokeColor ?? '#0f172a';
  const fill = element.fillColor ?? 'transparent';
  const strokeWidth = Math.max(1, Math.min(20, (element.strokeWidthRatio ?? 0.01) * 100));
  const common = {
    stroke,
    strokeWidth,
    fill,
    vectorEffect: 'non-scaling-stroke' as const
  };
  if (element.shape === 'ELLIPSE') {
    return <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 1 1"><ellipse cx="0.5" cy="0.5" rx="0.48" ry="0.48" {...common} /></svg>;
  }
  if (element.shape === 'LINE' || element.shape === 'ARROW') {
    const markerId = `assembly-overlay-arrowhead-${element.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    return (
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-hidden" viewBox="0 0 1 1">
        {element.shape === 'ARROW' ? (
          <defs>
            <marker
              id={markerId}
              markerWidth="0.08"
              markerHeight="0.08"
              markerUnits="userSpaceOnUse"
              orient="auto"
              refX="0.075"
              refY="0.04"
              viewBox="0 0 0.08 0.08"
            >
              <path d="M0 0 L0.08 0.04 L0 0.08 Z" fill={stroke} stroke="none" />
            </marker>
          </defs>
        ) : null}
        <line
          x1={start.xRatio}
          y1={start.yRatio}
          x2={end.xRatio}
          y2={end.yRatio}
          {...common}
          markerEnd={element.shape === 'ARROW' ? `url(#${markerId})` : undefined}
        />
      </svg>
    );
  }
  return <span aria-hidden="true" className="absolute inset-0 rounded-sm" style={{ border: `${strokeWidth}px solid ${stroke}`, backgroundColor: fill }} />;
}

function OverlayContent({
  element,
  assets
}: {
  element: RenderElement;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
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
  if (element.kind === 'IMAGE') {
    return <ImageOverlayContent element={element} assets={assets} />;
  }
  return <ShapeContent element={element} />;
}

/**
 * Overlay assets are served from authenticated storage routes. Keep image
 * loading on the shared protected-image path so the browser never requests a
 * protected URL as a native <img src>, which would omit the API auth headers.
 */
function ImageOverlayContent({
  element,
  assets
}: {
  element: Extract<RenderElement, { kind: 'IMAGE' }>;
  assets?: Record<string, AssemblyProcedureOverlayAssetDto>;
}) {
  const source = element.assetId ? imageSource(element.assetId, assets) : null;
  const { blobUrl, error } = useProtectedImageBlobUrl(source);
  if (!element.assetId) {
    return <span className="flex h-full w-full items-center justify-center bg-slate-200/80 text-center text-[0.65rem] font-semibold text-slate-700">画像assetを指定</span>;
  }

  if (error || !blobUrl) {
    return <span className="flex h-full w-full items-center justify-center bg-slate-200/80 text-center text-[0.65rem] font-semibold text-slate-700" data-image-error={error ? 'true' : undefined}>{error ? '画像の読み込みに失敗しました' : '画像を読み込み中…'}</span>;
  }

  return (
    <img
      src={blobUrl}
      alt=""
      className="h-full w-full"
      draggable={false}
      style={{ objectFit: element.objectFit ?? 'contain' }}
      onError={(event) => {
        event.currentTarget.style.display = 'none';
        event.currentTarget.parentElement?.setAttribute('data-image-error', 'true');
      }}
    />
  );
}

export function AssemblyProcedureOverlayLayer({
  elements = [],
  crop,
  selectedOverlayId,
  interactive = false,
  onSelect,
  onNudge,
  assets,
  className
}: Props) {
  const projected = elements
    .map((element) => projectElement(element, crop))
    .filter((element): element is RenderElement => element != null)
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div
      className={clsx('pointer-events-none absolute inset-0 overflow-hidden', className)}
      data-testid="assembly-procedure-overlay-layer"
      style={{ containerType: 'inline-size' } as CSSProperties}
    >
      {projected.map((element) => {
        const selected = selectedOverlayId === element.id;
        const style: CSSProperties = {
          left: `${element.bbox.xRatio * 100}%`,
          top: `${element.bbox.yRatio * 100}%`,
          width: `${element.bbox.widthRatio * 100}%`,
          height: `${element.bbox.heightRatio * 100}%`,
          opacity: element.opacity ?? 1,
          zIndex: element.zIndex,
          backgroundColor: element.mask?.enabled ? element.mask.color : undefined
        };
        const content = (
          <div
            className={clsx(
              'absolute overflow-hidden p-0.5',
              interactive ? 'pointer-events-auto cursor-pointer rounded-sm' : 'pointer-events-none',
              selected && 'outline outline-2 outline-cyan-400 outline-offset-1'
            )}
            style={style}
            data-overlay-id={element.id}
            data-testid={`assembly-procedure-overlay-${element.id}`}
            aria-label={interactive ? elementLabel(element) : undefined}
            aria-pressed={interactive ? selected : undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            onClick={interactive ? (event) => { event.stopPropagation(); onSelect?.(element.id); } : undefined}
            onKeyDown={interactive ? (event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                const step = event.shiftKey ? 0.02 : 0.005;
                const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
                const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
                onNudge?.(element.id, dx, dy);
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect?.(element.id);
              }
            } : undefined}
          >
            <OverlayContent element={element} assets={assets} />
          </div>
        );
        return <span key={element.id}>{content}</span>;
      })}
    </div>
  );
}

export function assemblyProcedureOverlayElementLabel(element: AssemblyProcedureOverlayElement): string {
  return elementLabel(element);
}

export type { Props as AssemblyProcedureOverlayLayerProps };
