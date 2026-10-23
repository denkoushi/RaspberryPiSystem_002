import { useEffect, useMemo, useRef, useState } from 'react';

import { Dialog } from '../../components/ui/Dialog';
import { AssemblyProcedureSequenceViewer } from '../assembly/AssemblyProcedureSequenceViewer';

import { SelfInspectionNonconformityPanel } from './SelfInspectionNonconformityPanel';
import { WorkInstructionImageDialog } from './WorkInstructionImageDialog';
import { WorkInstructionStepCard } from './WorkInstructionStepCard';
import {
  findWorkInstructionImageIndex,
  getWorkInstructionImageSteps,
  moveWorkInstructionImageIndex
} from './workInstructionViewerNavigation';

import type { SelfInspectionNonconformity } from '../../api/domains/self-inspection-nonconformities';
import type { WorkInstructionGroup } from '../../api/domains/work-instructions';
import type { AssemblyProcedureSequenceDto } from '../assembly/types';

export type WorkInstructionViewerDialogProps = {
  manualSequence?: AssemblyProcedureSequenceDto;
  hasWorkInstruction?: boolean;
  isOpen: boolean;
  partNumber: string;
  shootingTarget: string;
  group: WorkInstructionGroup | undefined;
  isLoading: boolean;
  errorMessage?: string;
  onClose: () => void;
  nonconformityItems?: ReadonlyArray<SelfInspectionNonconformity>;
  nonconformityIsLoading?: boolean;
  nonconformityErrorMessage?: string;
  onRetryNonconformities?: () => void;
  /** Manager-only entry point. The API remains the authority for write access. */
  onEdit?: () => void;
};

export function WorkInstructionViewerDialog({
  isOpen,
  manualSequence,
  hasWorkInstruction = true,
  partNumber,
  shootingTarget,
  group,
  isLoading,
  errorMessage,
  onClose,
  nonconformityItems,
  nonconformityIsLoading,
  nonconformityErrorMessage,
  onRetryNonconformities,
  onEdit
}: WorkInstructionViewerDialogProps) {
  const [source, setSource] = useState<'original' | 'manual'>('original');
  const [twoPages, setTwoPages] = useState(false);
  useEffect(() => { setSource('original'); setSelectedImageStepId(null); setTwoPages(false); }, [isOpen, partNumber, shootingTarget]);
  const hasManual = Boolean(manualSequence?.documents.length);
  const showManual = hasManual && (!hasWorkInstruction || source === 'manual');
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

  const sourceOptions = [['original', '段取写真'], ['manual', '手順書']] as const;
  const selectSource = (value: 'original' | 'manual') => { setSelectedImageStepId(null); setSource(value); };
  const sourceTabs = (
    hasManual && hasWorkInstruction ? <div role="tablist" aria-label="資料" className="flex shrink-0 gap-1">{sourceOptions.map(([value, label]) => <button key={value} role="tab" aria-selected={source === value} className={`min-h-11 rounded-lg border border-white/25 px-3 text-sm font-bold ${source === value ? 'bg-cyan-950 text-cyan-50' : ''}`} onClick={() => selectSource(value)}>{label}</button>)}</div> : null
  );

  const railSourceIcons = {
    original: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
    manual: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>
  } as const;
  const showRailExtra = (hasManual && hasWorkInstruction) || (nonconformityItems?.length ?? 0) > 0 || nonconformityIsLoading || Boolean(nonconformityErrorMessage);
  const railExtra = showRailExtra ? (
    <>
      {hasManual && hasWorkInstruction ? <div role="tablist" aria-label="資料" aria-orientation="vertical" className="flex flex-col gap-1.5">{sourceOptions.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={source === value} className={`flex min-h-14 w-[52px] flex-col items-center justify-center gap-0.5 rounded-[10px] border text-[11px] font-bold ${source === value ? 'border-cyan-400 bg-cyan-950 text-cyan-50' : 'border-[#344252] text-[#eef3f6]'}`} onClick={() => selectSource(value)}><svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{railSourceIcons[value]}</svg>{label}</button>)}</div> : null}
      <SelfInspectionNonconformityPanel
        items={nonconformityItems}
        isLoading={nonconformityIsLoading}
        errorMessage={nonconformityErrorMessage}
        onRetry={onRetryNonconformities}
        variant="rail"
      />
    </>
  ) : null;

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        ariaLabel="作業要領書"
        closeOnBackdrop={false}
        closeOnEsc={selectedImageStep == null}
        trapFocus={selectedImageStep == null}
        initialFocusRef={showManual ? undefined : closeButtonRef}
        size="full"
        overlayZIndex={80}
        overlayClassName={showManual ? '!p-0' : undefined}
        className={showManual
          ? 'relative !my-0 flex h-dvh !max-h-[100dvh] !w-full flex-col overflow-hidden !rounded-none !border-0 !bg-slate-950 !p-0 !text-white !shadow-none'
          : "!my-0 flex h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)] flex-col overflow-hidden !rounded-lg !border !border-white/20 !bg-slate-950 !p-0 !text-white !shadow-none"}
      >
        {showManual ? null : <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/15 bg-slate-900 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white">作業要領書</h2>
            <p className="truncate text-sm text-white/60">
              {partNumber} ・ {shootingTarget}
            </p>
          </div>
          {sourceTabs}
          {!showManual && group?.updateAvailable ? (
            <span
              className="shrink-0 rounded border border-amber-300/50 bg-amber-300/15 px-2 py-1 text-xs font-bold text-amber-100"
              role="status"
            >
              新しい原本があります
            </span>
          ) : null}
          <SelfInspectionNonconformityPanel
            items={nonconformityItems}
            isLoading={nonconformityIsLoading}
            errorMessage={nonconformityErrorMessage}
            onRetry={onRetryNonconformities}
          />
          {onEdit && hasWorkInstruction && !showManual ? (
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
        </header>}

        {showManual && manualSequence ? <AssemblyProcedureSequenceViewer sequence={manualSequence} layout="manuals" showCurrentMarkerButton={false} twoPages={twoPages} onToggleTwoPages={() => setTwoPages(value => !value)} railExtra={railExtra} onClose={onClose} className="min-h-0 w-full flex-1" /> : isLoading ? (
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
