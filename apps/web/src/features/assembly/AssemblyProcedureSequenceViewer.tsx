import {
  isAssemblyProcedurePointInCrop,
  type AssemblyProcedureCropRect
} from '@raspi-system/shared-types';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button';

import { AssemblyProcedureImageWithMarkers } from './AssemblyProcedureCanvas';
import {
  AssemblyProcedureCropMinimap,
  AssemblyProcedureCropView
} from './AssemblyProcedureCropView';
import { AssemblyProcedureMarkerLayer } from './AssemblyProcedureMarkerLayer';
import { projectAssemblyProcedureMarkerToCrop } from './assemblyProcedureMarkerProjection';
import { getSequenceDocumentPages } from './assemblyTemplateDraft';
import { KioskDocumentPageImage } from './KioskDocumentPageImage';

import type { AssemblyCanvasBolt, AssemblyCanvasCheckItem } from './AssemblyProcedureCanvas';
import type {
  AssemblyProcedureSequenceDto,
  AssemblyProcedureSequencePageDto,
  AssemblyProcedureSequenceStepDto
} from './types';

type Props = {
  sequence: AssemblyProcedureSequenceDto;
  className?: string;
  boltMarkers?: AssemblyCanvasBolt[];
  checkMarkers?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  currentMarker?: {
    kioskDocumentId?: string | null;
    assemblyProcedureDocumentId?: string | null;
    pageIndex?: number | null;
    xRatio: number;
    yRatio: number;
  } | null;
  onToggleCheckItem?: (checkItemId: string) => void;
  onCurrentPageChange?: (page: AssemblyProcedureSequencePageDto | null) => void;
};

function fallbackSteps(sequence: AssemblyProcedureSequenceDto): AssemblyProcedureSequenceStepDto[] {
  let sortOrder = 0;
  return sequence.documents.flatMap((document) =>
    getSequenceDocumentPages(document).map((page) => ({
      id: `client-document-expansion:${page.source}:${page.documentId}:${page.pageIndex}`,
      sortOrder: sortOrder++,
      kioskDocumentId: document.kioskDocumentId,
      assemblyProcedureDocumentId: document.assemblyProcedureDocumentId,
      pageIndex: page.pageIndex,
      viewMode: 'full_page',
      cropXRatio: null,
      cropYRatio: null,
      cropWidthRatio: null,
      cropHeightRatio: null,
      title: null,
      instructionText: null,
      emphasis: 'normal',
      documentType: document.documentType,
      documentTitle: document.displayTitle || document.title,
      pageUrl: page.pageUrl
    }))
  );
}

function stepCrop(step: AssemblyProcedureSequenceStepDto): AssemblyProcedureCropRect | null {
  return step.viewMode === 'crop'
    ? {
        xRatio: step.cropXRatio!,
        yRatio: step.cropYRatio!,
        widthRatio: step.cropWidthRatio!,
        heightRatio: step.cropHeightRatio!
      }
    : null;
}

function stepMatchesMarker(
  step: AssemblyProcedureSequenceStepDto,
  marker: NonNullable<Props['currentMarker']>
): boolean {
  const documentMatches = marker.kioskDocumentId
    ? marker.kioskDocumentId === step.kioskDocumentId
    : marker.assemblyProcedureDocumentId === step.assemblyProcedureDocumentId;
  if (!documentMatches || (marker.pageIndex ?? 0) !== step.pageIndex) return false;
  const crop = stepCrop(step);
  return !crop || isAssemblyProcedurePointInCrop(marker, crop);
}

function AssemblyWorkStepStoryboard({
  steps,
  currentIndex,
  onSelect
}: {
  steps: AssemblyProcedureSequenceStepDto[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 62,
    overscan: 5
  });
  useEffect(() => {
    virtualizer.scrollToIndex(currentIndex, { align: 'auto' });
  }, [currentIndex, virtualizer]);
  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="assembly-work-step-storyboard">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const step = steps[row.index]!;
          return (
            <div
              key={step.id}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="absolute left-0 top-0 w-full p-1"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <button
                type="button"
                className={clsx(
                  'min-h-14 w-full rounded border px-2 py-1 text-left',
                  row.index === currentIndex
                    ? 'border-cyan-300 bg-cyan-950/60'
                    : 'border-white/10 bg-slate-950/55'
                )}
                onClick={() => onSelect(row.index)}
              >
                <span className="block truncate text-xs font-bold">
                  {row.index + 1}. {step.title || step.documentTitle}
                </span>
                <span className="block truncate text-[0.65rem] text-white/50">
                  P{step.pageIndex + 1} · {step.viewMode === 'crop' ? '矩形' : '全体'}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AssemblyProcedureSequenceViewer({
  sequence,
  className,
  boltMarkers = [],
  checkMarkers = [],
  selectedBoltId,
  currentMarker,
  onToggleCheckItem,
  onCurrentPageChange
}: Props) {
  const steps = useMemo(
    () => (sequence.steps && sequence.steps.length > 0 ? sequence.steps : fallbackSteps(sequence)),
    [sequence]
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [storyboardOpen, setStoryboardOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1366
  );
  const [showFullPage, setShowFullPage] = useState(false);
  const currentStep = steps[Math.max(0, Math.min(steps.length - 1, stepIndex))] ?? null;
  const crop = currentStep ? stepCrop(currentStep) : null;
  const currentPage = useMemo(
    () =>
      currentStep
        ? {
            source: currentStep.documentType,
            documentId:
              currentStep.kioskDocumentId ?? currentStep.assemblyProcedureDocumentId!,
            pageIndex: currentStep.pageIndex,
            pageUrl: currentStep.pageUrl
          }
        : null,
    [currentStep]
  );
  const visibleBolts = useMemo(
    () => boltMarkers.flatMap((marker) => {
      const transformed = projectAssemblyProcedureMarkerToCrop(marker, crop);
      return transformed ? [transformed] : [];
    }),
    [boltMarkers, crop]
  );
  const visibleChecks = useMemo(
    () => checkMarkers.flatMap((marker) => {
      const transformed = projectAssemblyProcedureMarkerToCrop(marker, crop);
      return transformed ? [transformed] : [];
    }),
    [checkMarkers, crop]
  );
  const segments = useMemo(() => {
    const result: Array<{ key: string; start: number; count: number }> = [];
    for (const step of steps) {
      const key = step.kioskDocumentId
        ? `kiosk:${step.kioskDocumentId}`
        : `assembly:${step.assemblyProcedureDocumentId}`;
      const last = result.at(-1);
      if (last?.key === key) last.count += 1;
      else result.push({ key, start: result.reduce((sum, item) => sum + item.count, 0), count: 1 });
    }
    return result;
  }, [steps]);

  useEffect(() => {
    setStepIndex(0);
  }, [sequence.machineNameKey]);
  useEffect(() => {
    setStepIndex((current) => Math.max(0, Math.min(steps.length - 1, current)));
  }, [steps.length]);
  useEffect(() => {
    setShowFullPage(false);
    onCurrentPageChange?.(currentPage);
  }, [currentPage, onCurrentPageChange]);

  const jumpToCurrentMarker = () => {
    if (!currentMarker) return;
    const nextIndex = steps.findIndex((step) => stepMatchesMarker(step, currentMarker));
    if (nextIndex >= 0) setStepIndex(nextIndex);
  };

  if (!currentStep || !currentPage) {
    return (
      <div className={className}>
        <div className="flex h-full min-h-[18rem] items-center justify-center bg-slate-950 text-sm font-semibold text-white/60">
          表示できる要領書ページがありません
        </div>
      </div>
    );
  }

  const emphasisClass =
    currentStep.emphasis === 'caution'
      ? 'border-amber-300/50 bg-amber-950/55 text-amber-50'
      : currentStep.emphasis === 'important'
        ? 'border-rose-300/45 bg-rose-950/45 text-rose-50'
        : 'border-cyan-300/25 bg-cyan-950/35 text-cyan-50';

  return (
    <div className={clsx('flex min-h-0 flex-col bg-slate-950', className)}>
      <header className="shrink-0 border-b border-white/10 bg-slate-900/90 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">
              手順 {stepIndex + 1}/{steps.length} · {currentStep.title || currentStep.documentTitle}
            </p>
            <p className="truncate text-xs text-white/50">
              {currentStep.documentTitle} / {currentStep.pageIndex + 1}ページ
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10 !px-2 text-xs"
              onClick={() => setStoryboardOpen((open) => !open)}
            >
              全手順
            </Button>
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10 !px-2 text-xs"
              disabled={!currentMarker}
              onClick={jumpToCurrentMarker}
            >
              現在の丸数字へ
            </Button>
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10 !px-2 text-xs"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((index) => index - 1)}
            >
              前手順
            </Button>
            <Button
              type="button"
              variant="primary"
              className="min-h-10 !px-2 text-xs"
              disabled={stepIndex === steps.length - 1}
              onClick={() => setStepIndex((index) => index + 1)}
            >
              次手順
            </Button>
          </div>
        </div>
        <div className="mt-2 flex h-4 overflow-hidden rounded bg-slate-950" aria-label="文書区間の全体マップ">
          {segments.map((segment, index) => (
            <button
              key={`${segment.key}:${segment.start}`}
              type="button"
              className={clsx(
                'min-w-1 border-r border-slate-950',
                index % 3 === 0 && 'bg-cyan-500',
                index % 3 === 1 && 'bg-violet-500',
                index % 3 === 2 && 'bg-emerald-500'
              )}
              style={{ flexGrow: segment.count }}
              onClick={() => setStepIndex(segment.start)}
            />
          ))}
        </div>
        {currentStep.title || currentStep.instructionText ? (
          <div className={clsx('mt-2 rounded border px-3 py-2', emphasisClass)}>
            <p className="text-sm font-bold">
              {currentStep.emphasis === 'caution'
                ? '⚠ 注意'
                : currentStep.emphasis === 'important'
                  ? '◆ 重要'
                  : '○ 標準'}
              {currentStep.title ? ` · ${currentStep.title}` : ''}
            </p>
            {currentStep.instructionText ? (
              <p className="mt-1 whitespace-pre-wrap text-xs">{currentStep.instructionText}</p>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1">
        {storyboardOpen ? (
          <aside className="flex w-48 shrink-0 flex-col border-r border-white/10 bg-slate-900/75">
            <AssemblyWorkStepStoryboard
              steps={steps}
              currentIndex={stepIndex}
              onSelect={setStepIndex}
            />
          </aside>
        ) : null}
        <div className="relative min-h-0 flex-1 overflow-hidden p-2">
          {crop && !showFullPage ? (
            <AssemblyProcedureCropView
              pageUrl={currentStep.pageUrl}
              crop={crop}
              className="h-full w-full"
              overlay={
                <AssemblyProcedureMarkerLayer
                  bolts={visibleBolts}
                  checkItems={visibleChecks}
                  selectedBoltId={selectedBoltId}
                  onToggleCheckItem={onToggleCheckItem}
                />
              }
            />
          ) : (
            <AssemblyProcedureImageWithMarkers
              fitToParent
              className="h-full w-full"
              imageContent={
                <KioskDocumentPageImage
                  pageUrl={currentStep.pageUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              }
              bolts={boltMarkers}
              checkItems={checkMarkers}
              selectedBoltId={selectedBoltId}
              onToggleCheckItem={onToggleCheckItem}
            />
          )}
          {crop ? (
            <div className="absolute bottom-3 right-3 grid w-32 gap-1">
              <AssemblyProcedureCropMinimap
                pageUrl={currentStep.pageUrl}
                crop={crop}
                className="h-20 w-32"
              />
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-10 bg-slate-950/85 !px-1 text-[0.65rem]"
                onClick={() => setShowFullPage((show) => !show)}
              >
                {showFullPage ? '矩形へ戻る' : '全体を一時表示'}
              </Button>
            </div>
          ) : null}
          {steps[stepIndex + 1] ? (
            <span className="hidden" aria-hidden="true">
              <KioskDocumentPageImage pageUrl={steps[stepIndex + 1]!.pageUrl} alt="" />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type { AssemblyProcedureSequencePageDto };
