import clsx from 'clsx';
import { useId } from 'react';

import { imageMarkerHasCalloutTip } from './imageMarkerCallout';

import type { ZoomedImageCanvasLayout } from './imageCanvasModel';
import type { ImageMarkerCalloutTip } from './imageMarkerCallout';

export type ImageMarkerCallout = ImageMarkerCalloutTip & {
  id: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  tone?: 'amber' | 'lime';
};

type Props = {
  items: ImageMarkerCallout[];
  selectedId?: string | null;
  layout: ZoomedImageCanvasLayout;
};

/** ドメインに依存せず、比率座標から同番号の矢視線と先端バッジを描画する。 */
export function ImageMarkerCalloutOverlay({
  items,
  selectedId,
  layout
}: Props) {
  const { image, contentWidth, contentHeight } = layout;
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const visibleItems = items.filter(imageMarkerHasCalloutTip);
  if (visibleItems.length === 0) return null;

  const colorFor = (item: ImageMarkerCallout) =>
    item.id === selectedId ? '#22d3ee' : item.tone === 'lime' ? '#84cc16' : '#f59e0b';

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5]"
      aria-hidden="true"
      data-testid="image-marker-callout-overlay"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${contentWidth} ${contentHeight}`}
        preserveAspectRatio="none"
        data-testid="image-marker-callout-svg"
      >
        <defs>
          {visibleItems.map((item) => {
            const color = colorFor(item);
            return (
              <marker
                key={`arrow-${item.id}`}
                id={`${prefix}-callout-${item.id}`}
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 Z" fill={color} />
              </marker>
            );
          })}
        </defs>
        {visibleItems.map((item) => {
          const tipX = image.offsetX + (item.calloutTipXRatio as number) * image.width;
          const tipY = image.offsetY + (item.calloutTipYRatio as number) * image.height;
          const markerX = image.offsetX + item.xRatio * image.width;
          const markerY = image.offsetY + item.yRatio * image.height;
          const active = item.id === selectedId;
          return (
            <line
              key={`line-${item.id}`}
              x1={markerX}
              y1={markerY}
              x2={tipX}
              y2={tipY}
              stroke={colorFor(item)}
              strokeWidth={active ? 2.2 : 1.8}
              markerEnd={`url(#${prefix}-callout-${item.id})`}
            />
          );
        })}
      </svg>
      {visibleItems.map((item) => {
        const active = item.id === selectedId;
        const lime = item.tone === 'lime';
        return (
          <div
            key={`tip-${item.id}`}
            className={clsx(
              'absolute flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[0.68rem] font-extrabold text-slate-900 shadow',
              active
                ? 'border-cyan-400 bg-cyan-300'
                : lime
                  ? 'border-lime-600 bg-lime-200'
                  : 'border-amber-500 bg-amber-200'
            )}
            style={{
              left: `${((image.offsetX + (item.calloutTipXRatio as number) * image.width) / contentWidth) * 100}%`,
              top: `${((image.offsetY + (item.calloutTipYRatio as number) * image.height) / contentHeight) * 100}%`
            }}
          >
            {item.markerNo}
          </div>
        );
      })}
    </div>
  );
}
