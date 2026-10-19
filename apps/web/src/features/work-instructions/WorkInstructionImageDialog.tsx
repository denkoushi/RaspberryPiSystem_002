import { useEffect, useRef } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';
import { ImageOverlayFrame } from '../overlays/ImageOverlayFrame';

import { workInstructionStepMemo } from './workInstructionViewerNavigation';

import type {
  WorkInstructionOverlayAsset,
  WorkInstructionStep
} from '../../api/domains/work-instructions';

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

export type WorkInstructionImageDialogProps = {
  step: WorkInstructionStep | null;
  photoIndex: number;
  photoCount: number;
  overlayAssets?: Record<string, WorkInstructionOverlayAsset>;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

export function WorkInstructionImageDialog({
  step,
  photoIndex,
  photoCount,
  overlayAssets,
  onClose,
  onPrevious,
  onNext
}: WorkInstructionImageDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { blobUrl, error } = useProtectedImageBlobUrl(step?.imageUrl);
  const position = photoIndex >= 0 ? photoIndex + 1 : 0;
  const hasPrevious = photoIndex > 0;
  const hasNext = photoIndex >= 0 && photoIndex < photoCount - 1;
  const accessibleOperation = step?.operation ? `${step.operation} ` : '';

  useEffect(() => {
    if (!step) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && hasPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === 'ArrowRight' && hasNext) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasNext, hasPrevious, onNext, onPrevious, step]);

  return (
    <Dialog
      isOpen={step != null}
      onClose={onClose}
      ariaLabel={`${accessibleOperation}作業要領画像`}
      closeOnBackdrop={false}
      initialFocusRef={closeButtonRef}
      size="full"
      overlayZIndex={90}
      className="!my-0 flex h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)] flex-col overflow-hidden !rounded-lg !border !border-white/20 !bg-slate-950 !p-0 !text-white !shadow-none"
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950 p-2">
        <button
          ref={closeButtonRef}
          type="button"
          className="absolute right-4 top-4 z-20 flex min-h-12 min-w-12 items-center justify-center rounded-full border border-white/30 bg-slate-900/90 text-3xl leading-none text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onClick={onClose}
          aria-label="画像を閉じる"
          title="画像を閉じる"
        >
          ×
        </button>

        <div className="flex min-h-0 flex-1 items-stretch rounded-t-lg border border-white/10 bg-black p-3" data-testid="work-instruction-image-stage">
          <Button
            type="button"
            variant="ghostOnDark"
            className="my-auto min-h-12 min-w-12 shrink-0 !px-2 text-3xl leading-none"
            disabled={!hasPrevious}
            onClick={onPrevious}
            aria-label="前の写真"
            title="前の写真"
          >
            ←
          </Button>
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden px-2">
            {error ? (
              <p className="text-sm font-semibold text-rose-100" role="alert">
                画像の読み込みに失敗しました
              </p>
            ) : blobUrl ? (
              step?.overlays && step.overlays.length > 0 ? (
                <ImageOverlayFrame
                  imageUrl={blobUrl}
                  protectedImage={false}
                  alt={`${accessibleOperation}作業要領の拡大画像（写真${position}/${photoCount}）`}
                  overlays={step.overlays}
                  assets={rendererAssets(overlayAssets)}
                  className="h-full w-full"
                />
              ) : (
                <img
                  src={blobUrl}
                  alt={`${accessibleOperation}作業要領の拡大画像（写真${position}/${photoCount}）`}
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                />
              )
            ) : (
              <p className="text-sm font-semibold text-white/60" role="status">
                画像を読み込み中…
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghostOnDark"
            className="my-auto min-h-12 min-w-12 shrink-0 !px-2 text-3xl leading-none"
            disabled={!hasNext}
            onClick={onNext}
            aria-label="次の写真"
            title="次の写真"
          >
            →
          </Button>
        </div>
        <p className="sr-only" aria-live="polite" data-testid="work-instruction-image-position">
          写真 {position} / {photoCount}
        </p>

        <div className="max-h-[28vh] shrink-0 overflow-y-auto rounded-b-lg border border-t-0 border-white/10 bg-slate-900 px-4 py-3 text-[21px] leading-8 text-white/90" data-testid="work-instruction-image-memo">
          <p className="whitespace-pre-wrap">{step ? workInstructionStepMemo(step) : ''}</p>
        </div>
      </div>
    </Dialog>
  );
}
