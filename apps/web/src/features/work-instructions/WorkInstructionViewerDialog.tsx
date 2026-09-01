import { useEffect, useMemo, useRef, useState } from 'react';

import { Dialog } from '../../components/ui/Dialog';

import { WorkInstructionImageDialog } from './WorkInstructionImageDialog';
import { WorkInstructionStepCard } from './WorkInstructionStepCard';
import {
  findWorkInstructionImageIndex,
  getWorkInstructionImageSteps,
  moveWorkInstructionImageIndex
} from './workInstructionViewerNavigation';

import type { WorkInstructionGroup } from '../../api/domains/work-instructions';

export type WorkInstructionViewerDialogProps = {
  isOpen: boolean;
  partNumber: string;
  shootingTarget: string;
  group: WorkInstructionGroup | undefined;
  isLoading: boolean;
  errorMessage?: string;
  onClose: () => void;
  /** Manager-only entry point. The API remains the authority for write access. */
  onEdit?: () => void;
};

export function WorkInstructionViewerDialog({
  isOpen,
  partNumber,
  shootingTarget,
  group,
  isLoading,
  errorMessage,
  onClose,
  onEdit
}: WorkInstructionViewerDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedImageStepId, setSelectedImageStepId] = useState<string | null>(null);
  const steps = useMemo(() => group?.steps ?? [], [group?.steps]);
  const imageSteps = useMemo(() => getWorkInstructionImageSteps(steps), [steps]);
  const selectedImageIndex = findWorkInstructionImageIndex(imageSteps, selectedImageStepId);
  const selectedImageStep = selectedImageIndex >= 0 ? imageSteps[selectedImageIndex] ?? null : null;

  useEffect(() => {
    if (!isOpen) setSelectedImageStepId(null);
  }, [isOpen]);

  useEffect(() => {
    if (selectedImageStepId && selectedImageIndex < 0) setSelectedImageStepId(null);
  }, [selectedImageStepId, selectedImageIndex]);

  const selectImageStep = (step: { id: string }) => setSelectedImageStepId(step.id);
  const moveImage = (delta: -1 | 1) => {
    const nextIndex = moveWorkInstructionImageIndex(imageSteps, selectedImageIndex, delta);
    const nextStep = nextIndex >= 0 ? imageSteps[nextIndex] : undefined;
    if (nextStep) setSelectedImageStepId(nextStep.id);
  };

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
          {group?.updateAvailable ? (
            <span
              className="shrink-0 rounded border border-amber-300/50 bg-amber-300/15 px-2 py-1 text-xs font-bold text-amber-100"
              role="status"
            >
              新しい原本があります
            </span>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-md border border-cyan-300/50 px-3 text-sm font-bold text-cyan-100 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onClick={onEdit}
            >
              編集
            </button>
          ) : null}
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
                onImageClick={selectImageStep}
                overlayAssets={group?.overlayAssets}
              />
            ))}
          </div>
        )}
      </Dialog>

      <WorkInstructionImageDialog
        step={isOpen ? selectedImageStep : null}
        photoIndex={selectedImageIndex}
        photoCount={imageSteps.length}
        overlayAssets={group?.overlayAssets ?? selectedImageStep?.overlayAssets}
        onClose={() => setSelectedImageStepId(null)}
        onPrevious={() => moveImage(-1)}
        onNext={() => moveImage(1)}
      />
    </>
  );
}
