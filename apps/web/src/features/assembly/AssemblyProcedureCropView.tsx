import clsx from 'clsx';

import { KioskDocumentPageImage } from './KioskDocumentPageImage';

import type { AssemblyProcedureCropRect } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

type Props = {
  pageUrl: string;
  crop: AssemblyProcedureCropRect | null;
  className?: string;
  overlay?: ReactNode;
  alt?: string;
};

export function AssemblyProcedureCropView({
  pageUrl,
  crop,
  className,
  overlay,
  alt = ''
}: Props) {
  if (!crop) {
    return (
      <div className={clsx('relative flex h-full w-full items-center justify-center', className)}>
        <KioskDocumentPageImage
          pageUrl={pageUrl}
          alt={alt}
          className="block max-h-full max-w-full object-contain"
        />
        {overlay}
      </div>
    );
  }

  return (
    <div className={clsx('flex h-full w-full items-center justify-center overflow-hidden', className)}>
      <div
        data-testid="assembly-procedure-crop-view"
        className="relative h-full w-full overflow-hidden bg-white"
      >
        <div
          className="absolute"
          style={{
            left: `${(-crop.xRatio / crop.widthRatio) * 100}%`,
            top: `${(-crop.yRatio / crop.heightRatio) * 100}%`,
            width: `${100 / crop.widthRatio}%`,
            height: `${100 / crop.heightRatio}%`
          }}
        >
          <KioskDocumentPageImage
            pageUrl={pageUrl}
            alt={alt}
            className="h-full w-full"
            loadingFallback={<span />}
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
      className={clsx('relative overflow-hidden rounded border border-white/30 bg-white', className)}
    >
      <KioskDocumentPageImage pageUrl={pageUrl} alt="" className="block h-full w-full object-contain" />
      <span
        className="pointer-events-none absolute border-2 border-cyan-400 bg-cyan-300/15"
        style={{
          left: `${crop.xRatio * 100}%`,
          top: `${crop.yRatio * 100}%`,
          width: `${crop.widthRatio * 100}%`,
          height: `${crop.heightRatio * 100}%`
        }}
      />
    </div>
  );
}
