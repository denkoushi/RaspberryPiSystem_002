import clsx from 'clsx';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import { OverlayLayer, type OverlayAssetMap, type OverlayLayerProps } from './OverlayLayer';

import type { OverlayElement } from '@raspi-system/shared-types';

type Size = { width: number; height: number };

export type ImageOverlayFrameProps = {
  /** API-relative protected image path or a blob/data URL when protected=false. */
  imageUrl: string | null | undefined;
  alt?: string;
  protectedImage?: boolean;
  overlays?: OverlayElement[];
  assets?: OverlayAssetMap;
  selectedOverlayId?: string | null;
  interactive?: boolean;
  onSelectOverlay?: OverlayLayerProps['onSelect'];
  onNudgeOverlay?: OverlayLayerProps['onNudge'];
  onUpdateOverlayBBox?: OverlayLayerProps['onUpdateBBox'];
  resolveAssetUrl?: OverlayLayerProps['resolveAssetUrl'];
  /** Content positioned inside the measured source-image frame. */
  children?: ReactNode;
  className?: string;
  frameClassName?: string;
  onFrameClick?: () => void;
  testId?: string;
};

function useContainSize(viewportRef: React.RefObject<HTMLElement | null>, natural: Size): Size {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [viewportRef]);
  if (natural.width <= 0 || natural.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(viewport.width / natural.width, viewport.height / natural.height);
  return { width: natural.width * scale, height: natural.height * scale };
}

/**
 * Keeps the image and all normalized overlays inside the same contain frame.
 * This is intentionally independent from any domain feature (Assembly,
 * WorkInstruction, or measurement); domain adapters only provide asset URLs.
 */
export function ImageOverlayFrame({
  imageUrl,
  alt = '',
  protectedImage = true,
  overlays = [],
  assets,
  selectedOverlayId,
  interactive = false,
  onSelectOverlay,
  onNudgeOverlay,
  onUpdateOverlayBBox,
  resolveAssetUrl,
  children,
  className,
  frameClassName,
  onFrameClick,
  testId = 'image-overlay-frame'
}: ImageOverlayFrameProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    // A frame can stay mounted while the selected step/image changes. Clear
    // the previous image dimensions so a new aspect ratio is measured before
    // contain sizing is calculated.
    setNatural({ width: 0, height: 0 });
  }, [imageUrl]);
  const protectedResult = useProtectedImageBlobUrl(protectedImage ? imageUrl : null);
  const resolvedUrl = protectedImage ? protectedResult.blobUrl : imageUrl?.trim() || null;
  const error = protectedImage ? protectedResult.error : null;
  const contain = useContainSize(viewportRef, natural);

  if (!imageUrl?.trim()) {
    return <div className={clsx('flex min-h-44 items-center justify-center bg-slate-950 text-sm text-white/60', className)} role="status">画像を選択してください</div>;
  }
  if (error) {
    return <div className={clsx('flex min-h-44 items-center justify-center bg-slate-950 text-sm text-rose-200', className)} role="alert">画像の読み込みに失敗しました</div>;
  }
  if (!resolvedUrl) {
    return <div className={clsx('flex min-h-44 items-center justify-center bg-slate-950 text-sm text-white/60', className)} role="status">画像を読み込み中…</div>;
  }

  const frameStyle = contain.width > 0
    ? { width: contain.width, height: contain.height }
    : { width: '100%', height: '100%' };
  return (
    <div ref={viewportRef} className={clsx('flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-slate-950', className)} data-testid={testId}>
      <div
        className={clsx('relative shrink-0 overflow-hidden', frameClassName)}
        style={frameStyle}
        onClick={onFrameClick}
      >
        <img
          src={resolvedUrl}
          alt={alt}
          className="pointer-events-none block h-full w-full select-none object-contain"
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) setNatural({ width: image.naturalWidth, height: image.naturalHeight });
          }}
        />
        <OverlayLayer
          elements={overlays}
          assets={assets}
          selectedOverlayId={selectedOverlayId}
          interactive={interactive}
          onSelect={onSelectOverlay}
          onNudge={onNudgeOverlay}
          onUpdateBBox={onUpdateOverlayBBox}
          resolveAssetUrl={resolveAssetUrl}
        />
        {children}
      </div>
    </div>
  );
}
