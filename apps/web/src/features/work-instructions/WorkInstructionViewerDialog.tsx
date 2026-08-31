import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import { Dialog } from '../../components/ui/Dialog';
import { useProtectedImageBlobUrl } from '../../hooks/useProtectedImageBlobUrl';

import type { WorkInstructionGroup, WorkInstructionStep } from '../../api/domains/work-instructions';

export type WorkInstructionViewerDialogProps = {
  isOpen: boolean;
  partNumber: string;
  shootingTarget: string;
  group: WorkInstructionGroup | undefined;
  isLoading: boolean;
  errorMessage?: string;
  onClose: () => void;
};

type WorkInstructionStepCardProps = {
  step: WorkInstructionStep;
  displayNumber: number;
  onImageClick: (step: WorkInstructionStep) => void;
};

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
        className="flex min-h-44 items-center justify-center bg-rose-950/40 px-3 text-center text-sm font-semibold text-rose-100"
        role="alert"
      >
        画像の読み込みに失敗しました
      </span>
    );
  }

  if (!blobUrl) {
    return (
      <span
        className="flex min-h-44 items-center justify-center bg-slate-950/60 px-3 text-sm font-semibold text-white/60"
        role="status"
      >
        画像を読み込み中…
      </span>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} draggable={false} />;
}

function WorkInstructionThumbnail({ imagePath, alt, className }: WorkInstructionImageProps) {
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
    <span ref={containerRef} className="block min-h-44">
      {shouldLoad ? (
        <WorkInstructionImage imagePath={imagePath} alt={alt} className={className} />
      ) : (
        <span className="flex min-h-44 items-center justify-center bg-slate-950/60 px-3 text-sm font-semibold text-white/60">
          画像を準備中…
        </span>
      )}
    </span>
  );
}

function WorkInstructionStepCard({ step, displayNumber, onImageClick }: WorkInstructionStepCardProps) {
  const hasImage = Boolean(step.imageUrl?.trim());

  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-white/15 bg-slate-900/80 shadow-lg">
      <header className="flex min-h-12 items-center gap-2 border-b border-white/10 px-3 py-2">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-extrabold text-white"
          aria-hidden="true"
        >
          {displayNumber}
        </span>
        <span className="min-w-0 text-sm font-bold text-white">手順 {displayNumber}</span>
      </header>

      {hasImage ? (
        <button
          type="button"
          className="block min-h-44 w-full overflow-hidden border-b border-white/10 bg-slate-950/60 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onClick={() => onImageClick(step)}
          aria-label={`手順${displayNumber}の画像を拡大`}
        >
          <WorkInstructionThumbnail
            imagePath={step.imageUrl}
            alt={`手順${displayNumber}の作業要領画像`}
            className="block h-56 w-full object-contain"
          />
        </button>
      ) : null}

      <div className={clsx('max-h-44 overflow-y-auto px-3 py-3 text-sm leading-6 text-white/90', !hasImage && 'min-h-44')}>
        <p className="whitespace-pre-wrap">{step.text}</p>
      </div>
    </article>
  );
}

type WorkInstructionImageDialogProps = {
  step: WorkInstructionStep | null;
  onClose: () => void;
};

function WorkInstructionImageDialog({ step, onClose }: WorkInstructionImageDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { blobUrl, error } = useProtectedImageBlobUrl(step?.imageUrl);

  return (
    <Dialog
      isOpen={step != null}
      onClose={onClose}
      ariaLabel="作業要領画像"
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
          className="absolute right-4 top-4 z-10 flex min-h-12 min-w-12 items-center justify-center rounded-full border border-white/30 bg-slate-900/90 text-3xl leading-none text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onClick={onClose}
          aria-label="画像を閉じる"
          title="画像を閉じる"
        >
          ×
        </button>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-t-lg border border-white/10 bg-black p-3">
          {error ? (
            <p className="text-sm font-semibold text-rose-100" role="alert">
              画像の読み込みに失敗しました
            </p>
          ) : blobUrl ? (
            <img
              src={blobUrl}
              alt="作業要領の拡大画像"
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          ) : (
            <p className="text-sm font-semibold text-white/60" role="status">
              画像を読み込み中…
            </p>
          )}
        </div>

        <div className="max-h-[28vh] shrink-0 overflow-y-auto rounded-b-lg border border-t-0 border-white/10 bg-slate-900 px-4 py-3 text-sm leading-6 text-white/90">
          <p className="mb-1 text-xs font-bold tracking-wide text-emerald-200">MEMO</p>
          <p className="whitespace-pre-wrap">{step?.text ?? ''}</p>
        </div>
      </div>
    </Dialog>
  );
}

export function WorkInstructionViewerDialog({
  isOpen,
  partNumber,
  shootingTarget,
  group,
  isLoading,
  errorMessage,
  onClose
}: WorkInstructionViewerDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedImageStep, setSelectedImageStep] = useState<WorkInstructionStep | null>(null);

  useEffect(() => {
    if (!isOpen) setSelectedImageStep(null);
  }, [isOpen]);

  const steps = group?.steps ?? [];

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        ariaLabel="作業要領書"
        closeOnBackdrop={false}
        closeOnEsc={selectedImageStep == null}
        trapFocus={selectedImageStep == null}
        initialFocusRef={closeButtonRef}
        size="full"
        overlayZIndex={80}
        className="!my-0 flex h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)] flex-col overflow-hidden !rounded-lg !border !border-white/20 !bg-slate-950 !p-0 !text-white !shadow-none"
      >
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/15 bg-slate-900 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white">作業要領書</h2>
            <p className="truncate text-sm text-white/60">
              {partNumber} ・ {shootingTarget}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="min-h-11 shrink-0 rounded-md border border-white/25 px-3 text-sm font-bold text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            onClick={onClose}
            aria-label="自主検査画面に戻る"
          >
            自主検査画面に戻る
          </button>
        </header>

        {isLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 px-4 text-sm font-semibold text-white/60" role="status">
            作業要領を読み込み中…
          </div>
        ) : errorMessage ? (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 px-4 text-sm font-semibold text-rose-100" role="alert">
            {errorMessage}
          </div>
        ) : steps.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 px-4 text-sm text-white/60">
            表示できる作業要領がありません
          </div>
        ) : (
          <div
            className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto bg-slate-950 p-3 min-[1280px]:grid-cols-3 min-[1800px]:grid-cols-4"
            data-testid="work-instruction-card-grid"
          >
            {steps.map((step, index) => (
              <WorkInstructionStepCard
                key={step.id}
                step={step}
                displayNumber={index + 1}
                onImageClick={setSelectedImageStep}
              />
            ))}
          </div>
        )}
      </Dialog>

      <WorkInstructionImageDialog
        step={isOpen ? selectedImageStep : null}
        onClose={() => setSelectedImageStep(null)}
      />
    </>
  );
}
