import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';
import { ImageOverlayFrame } from '../overlays/ImageOverlayFrame';

import { hasWorkInstructionImage, workInstructionStepMemo } from './workInstructionViewerNavigation';

import type {
  WorkInstructionOverlayAsset,
  WorkInstructionStep
} from '../../api/domains/work-instructions';

const WORK_INSTRUCTION_CARD_IMAGE_MIN_HEIGHT = 'min-h-64';
const WORK_INSTRUCTION_CARD_IMAGE_HEIGHT = 'h-64';

type WorkInstructionImageProps = {
  imagePath: string | null | undefined;
  alt: string;
  className?: string;
};

function WorkInstructionImage({ imagePath, alt, className }: WorkInstructionImageProps) {
  const { blobUrl, error } = useProtectedImageBlobUrl(imagePath);

  if (error) {
    return (
      <span
        className={clsx('flex min-h-64 items-center justify-center bg-rose-950/40 px-3 text-center text-sm font-semibold text-rose-100', className)}
        role="alert"
      >
        画像の読み込みに失敗しました
      </span>
    );
  }

  if (!blobUrl) {
    return (
      <span
        className={clsx('flex min-h-64 items-center justify-center bg-slate-950/60 px-3 text-sm font-semibold text-white/60', className)}
        role="status"
      >
        画像を読み込み中…
      </span>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} draggable={false} />;
}

function rendererAssets(
  assets?: Record<string, WorkInstructionOverlayAsset>
) {
  if (!assets) return undefined;
  return Object.fromEntries(
    Object.entries(assets).map(([assetId, asset]) => [assetId, {
      assetId: asset.assetId || assetId,
      storageKey: asset.storageKey ?? assetId,
      contentType: asset.contentType ?? 'image/png',
      byteSize: asset.byteSize ?? 0,
      sha256: asset.sha256,
      url: asset.url,
      relativeUrl: asset.relativeUrl
    }])
  );
}

function WorkInstructionOverlayImage({
  imagePath,
  alt,
  overlays,
  assets,
  className
}: {
  imagePath: string;
  alt: string;
  overlays: WorkInstructionStep['overlays'];
  assets?: Record<string, WorkInstructionOverlayAsset>;
  className?: string;
}) {
  const { blobUrl, error } = useProtectedImageBlobUrl(imagePath);
  if (error) {
    return (
      <span className={clsx('flex min-h-64 items-center justify-center bg-rose-950/40 px-3 text-center text-sm font-semibold text-rose-100', className)} role="alert">
        画像の読み込みに失敗しました
      </span>
    );
  }
  if (!blobUrl) {
    return (
      <span className={clsx('flex min-h-64 items-center justify-center bg-slate-950/60 px-3 text-sm font-semibold text-white/60', className)} role="status">
        画像を読み込み中…
      </span>
    );
  }
  return <ImageOverlayFrame imageUrl={blobUrl} protectedImage={false} alt={alt} overlays={overlays ?? []} assets={rendererAssets(assets)} className={clsx('h-full w-full', className)} />;
}

function WorkInstructionThumbnail({
  imagePath,
  alt,
  className,
  overlays,
  assets
}: WorkInstructionImageProps & {
  overlays?: WorkInstructionStep['overlays'];
  assets?: Record<string, WorkInstructionOverlayAsset>;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (shouldLoad) return undefined;
    const node = containerRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: '320px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <span ref={containerRef} className={clsx('block', WORK_INSTRUCTION_CARD_IMAGE_MIN_HEIGHT)}>
      {shouldLoad ? (
        overlays && overlays.length > 0 ? (
          <WorkInstructionOverlayImage
            imagePath={imagePath ?? ''}
            alt={alt}
            overlays={overlays}
            assets={assets}
            className={className}
          />
        ) : (
          <WorkInstructionImage imagePath={imagePath} alt={alt} className={className} />
        )
      ) : (
        <span className={clsx('flex items-center justify-center bg-slate-950/60 px-3 text-sm font-semibold text-white/60', WORK_INSTRUCTION_CARD_IMAGE_MIN_HEIGHT)}>
          画像を準備中…
        </span>
      )}
    </span>
  );
}

export type WorkInstructionStepCardProps = {
  step: WorkInstructionStep;
  displayNumber: number;
  onImageClick: (step: WorkInstructionStep) => void;
  overlayAssets?: Record<string, WorkInstructionOverlayAsset>;
};

export function WorkInstructionStepCard({
  step,
  displayNumber,
  onImageClick,
  overlayAssets
}: WorkInstructionStepCardProps) {
  const hasImage = hasWorkInstructionImage(step);

  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-white/15 bg-slate-900/80 shadow-lg" aria-label={`手順 ${displayNumber}`}>

      {hasImage ? (
        <button
          type="button"
          className={clsx('relative block w-full overflow-hidden border-b border-white/10 bg-slate-950/60 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300', WORK_INSTRUCTION_CARD_IMAGE_MIN_HEIGHT)}
          onClick={() => onImageClick(step)}
          aria-label={`手順${displayNumber}の画像を拡大`}
        >
          <span
            className="absolute left-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-extrabold text-white shadow"
            aria-hidden="true"
          >
            {displayNumber}
          </span>
          <WorkInstructionThumbnail
            imagePath={step.imageUrl}
            alt={`手順${displayNumber}の作業要領画像`}
            className={clsx('block w-full object-contain', WORK_INSTRUCTION_CARD_IMAGE_HEIGHT)}
            overlays={step.overlays}
            assets={overlayAssets ?? step.overlayAssets}
          />
        </button>
      ) : null}

      <div className={clsx('max-h-44 overflow-y-auto px-3 py-3 text-sm leading-6 text-white/90', !hasImage && WORK_INSTRUCTION_CARD_IMAGE_MIN_HEIGHT)}>
        {hasImage ? (
          <p className="whitespace-pre-wrap">{workInstructionStepMemo(step)}</p>
        ) : (
          <div className="flex items-start gap-2">
            <span
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-extrabold leading-none text-white"
              aria-hidden="true"
            >
              {displayNumber}
            </span>
            <p className="whitespace-pre-wrap">{workInstructionStepMemo(step)}</p>
          </div>
        )}
      </div>
    </article>
  );
}
