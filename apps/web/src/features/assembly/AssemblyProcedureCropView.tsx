import clsx from 'clsx';
import { useRef, useState } from 'react';

import { KioskDocumentPageImage } from './KioskDocumentPageImage';
import { useAssemblyProcedureContainBox } from './useAssemblyProcedureContainBox';

import type { AssemblyProcedureCropRect } from '@raspi-system/shared-types';
import type { MouseEvent, ReactEventHandler, ReactNode } from 'react';

type Props = {
  pageUrl: string;
  crop: AssemblyProcedureCropRect | null;
  className?: string;
  overlay?: ReactNode;
  alt?: string;
  onPlacementClick?: (xRatio: number, yRatio: number) => void;
};

export function AssemblyProcedureCropView({
  pageUrl,
  crop,
  className,
  overlay,
  alt = '',
  onPlacementClick
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const effectiveCrop = crop ?? {
    xRatio: 0,
    yRatio: 0,
    widthRatio: 1,
    heightRatio: 1
  };
  const fitted = useAssemblyProcedureContainBox(
    viewportRef,
    naturalSize.width * effectiveCrop.widthRatio,
    naturalSize.height * effectiveCrop.heightRatio
  );
  const handleLoad: ReactEventHandler<HTMLImageElement> = (event) => {
    const image = event.currentTarget;
    setNaturalSize((current) =>
      current.width === image.naturalWidth && current.height === image.naturalHeight
        ? current
        : { width: image.naturalWidth, height: image.naturalHeight }
    );
  };
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onPlacementClick) return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return;
    onPlacementClick(xRatio, yRatio);
  };

  return (
    <div
      ref={viewportRef}
      className={clsx('flex h-full w-full items-center justify-center overflow-hidden', className)}
    >
      <div
        ref={frameRef}
        data-testid={crop ? 'assembly-procedure-crop-view' : 'assembly-procedure-full-page-view'}
        className={clsx(
          'relative overflow-hidden bg-white',
          onPlacementClick && 'cursor-crosshair'
        )}
        onClick={handleClick}
        style={{
          width: fitted.width > 0 ? fitted.width : '100%',
          height: fitted.height > 0 ? fitted.height : '100%'
        }}
      >
        <div
          className="absolute"
          style={{
            left: `${(-effectiveCrop.xRatio / effectiveCrop.widthRatio) * 100}%`,
            top: `${(-effectiveCrop.yRatio / effectiveCrop.heightRatio) * 100}%`,
            width: `${100 / effectiveCrop.widthRatio}%`,
            height: `${100 / effectiveCrop.heightRatio}%`
          }}
        >
          <KioskDocumentPageImage
            pageUrl={pageUrl}
            alt={alt}
            className="h-full w-full"
            loadingFallback={<span />}
            onLoad={handleLoad}
          />
        </div>
        {overlay ? <div className="absolute inset-0">{overlay}</div> : null}
      </div>
    </div>
  );
}

export function AssemblyProcedureCropMinimap({
  pageUrl,
  crop,
  className
}: {
  pageUrl: string;
  crop: AssemblyProcedureCropRect;
  className?: string;
}) {
  return (
    <div
      data-testid="assembly-procedure-crop-minimap"
      className={clsx('overflow-hidden rounded border border-white/30 bg-white', className)}
    >
      <AssemblyProcedureCropView
        pageUrl={pageUrl}
        crop={null}
        overlay={
          <span
            className="pointer-events-none absolute border-2 border-cyan-400 bg-cyan-300/15"
            style={{
              left: `${crop.xRatio * 100}%`,
              top: `${crop.yRatio * 100}%`,
              width: `${crop.widthRatio * 100}%`,
              height: `${crop.heightRatio * 100}%`
            }}
          />
        }
      />
    </div>
  );
}
