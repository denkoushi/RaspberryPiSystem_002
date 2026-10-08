import {
  isAssemblyProcedurePointInCrop,
  type AssemblyProcedureCropRect,
  type AssemblyProcedureOverlayElement
} from '@raspi-system/shared-types';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button';

import { AssemblyProcedureImageWithMarkers } from './AssemblyProcedureCanvas';
import {
  AssemblyProcedureCropMinimap,
  AssemblyProcedureCropView
} from './AssemblyProcedureCropView';
import { AssemblyProcedureMarkerLayer } from './AssemblyProcedureMarkerLayer';
import { projectAssemblyProcedureMarkerToCrop } from './assemblyProcedureMarkerProjection';
import { AssemblyProcedureOverlayLayer } from './AssemblyProcedureOverlayLayer';
import { getSequenceDocumentPages } from './assemblyTemplateDraft';
import { KioskDocumentPageImage } from './KioskDocumentPageImage';
import { ProcedureManualPageRail } from './procedure-manuals/ProcedureManualPageRail';

import type { AssemblyCanvasBolt, AssemblyCanvasCheckItem } from './AssemblyProcedureCanvas';
import type {
  AssemblyProcedureOverlayAssetDto,
  AssemblyProcedureSequenceDto,
  AssemblyProcedureSequencePageDto,
  AssemblyProcedureSequenceStepDto
} from './types';

type Props = {
  sequence: AssemblyProcedureSequenceDto;
  initialDocumentId?: string;
  className?: string;
  showCurrentMarkerButton?: boolean;
  layout?: 'session' | 'manuals';
  listOpen?: boolean;
  onToggleList?: () => void;
  twoPages?: boolean;
  onToggleTwoPages?: () => void;
  onCurrentStepChange?: (step: AssemblyProcedureSequenceStepDto | null, index: number, total: number) => void;
  boltMarkers?: AssemblyCanvasBolt[];
  checkMarkers?: AssemblyCanvasCheckItem[];
  selectedBoltId?: string | null;
  inputTargetBoltId?: string | null;
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
  currentStep,
  boltMarkers,
  checkMarkers,
  inputTargetBoltId,
  onSelect,
  getStepOverlays,
  getStepAssets
}: {
  steps: AssemblyProcedureSequenceStepDto[];
  currentIndex: number;
  currentStep: AssemblyProcedureSequenceStepDto;
  boltMarkers: AssemblyCanvasBolt[];
  checkMarkers: AssemblyCanvasCheckItem[];
  inputTargetBoltId?: string | null;
  onSelect: (index: number) => void;
  getStepOverlays: (step: AssemblyProcedureSequenceStepDto) => AssemblyProcedureOverlayElement[];
  getStepAssets: (step: AssemblyProcedureSequenceStepDto) => Record<string, AssemblyProcedureOverlayAssetDto> | undefined;
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
          const sharesCurrentPage =
            step.pageIndex === currentStep.pageIndex &&
            step.kioskDocumentId === currentStep.kioskDocumentId &&
            step.assemblyProcedureDocumentId === currentStep.assemblyProcedureDocumentId;
          const crop = stepCrop(step);
          const thumbnailBolts = sharesCurrentPage
            ? boltMarkers.flatMap((marker) => {
                const projected = projectAssemblyProcedureMarkerToCrop(marker, crop);
                return projected ? [projected] : [];
              })
            : [];
          const thumbnailChecks = sharesCurrentPage
            ? checkMarkers.flatMap((marker) => {
                const projected = projectAssemblyProcedureMarkerToCrop(marker, crop);
                return projected ? [projected] : [];
              })
            : [];
          return (
            <div
              key={step.id}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="absolute left-0 top-0 w-full p-1"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <div
                className={clsx(
                  'flex min-h-14 w-full items-center gap-2 rounded border p-1',
                  row.index === currentIndex
                    ? 'border-cyan-300 bg-cyan-950/60'
                    : 'border-white/10 bg-slate-950/55'
                )}
              >
                <div
                  className="h-12 w-16 shrink-0 overflow-hidden rounded border border-white/15 bg-white"
                  aria-hidden="true"
                  data-testid={`assembly-work-step-thumbnail-${row.index}`}
                >
                  <AssemblyProcedureCropView
                    pageUrl={step.pageUrl}
                    crop={crop}
                    className="h-full w-full"
                    overlay={
                      <>
                        <AssemblyProcedureOverlayLayer
                          elements={getStepOverlays(step)}
                          crop={crop}
                          assets={getStepAssets(step)}
                        />
                        <AssemblyProcedureMarkerLayer
                          bolts={thumbnailBolts}
                          checkItems={thumbnailChecks}
                          inputTargetBoltId={inputTargetBoltId}
                          density="compact"
                        />
                      </>
                    }
                  />
                </div>
                <button
                  type="button"
                  className="min-h-12 min-w-0 flex-1 px-1 text-left"
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AssemblyProcedureSequenceViewer({
  sequence,
  initialDocumentId,
  className,
  boltMarkers = [],
  checkMarkers = [],
  selectedBoltId,
  inputTargetBoltId,
  currentMarker,
  onToggleCheckItem,
  onCurrentPageChange,
  showCurrentMarkerButton = true,
  layout = 'session',
  onCurrentStepChange,
  listOpen = false,
  onToggleList,
  twoPages = false,
  onToggleTwoPages
}: Props) {
  const steps = useMemo(
    () => (sequence.steps && sequence.steps.length > 0 ? sequence.steps : fallbackSteps(sequence)),
    [sequence]
  );
  const initialStepIndex = initialDocumentId
    ? Math.max(0, steps.findIndex(step => (step.kioskDocumentId ?? step.assemblyProcedureDocumentId) === initialDocumentId))
    : 0;
  const [stepIndex, setStepIndex] = useState(initialStepIndex);
  const [storyboardOpen, setStoryboardOpen] = useState(
    () => layout !== 'manuals' && typeof window !== 'undefined' && window.innerWidth >= 1366
  );
  const [showFullPage, setShowFullPage] = useState(false);
  const [pageShape, setPageShape] = useState<{ url: string; landscape: boolean } | null>(null);
  const [fitChoice, setFitChoice] = useState<{ url: string; mode: 'contain' | 'width' } | null>(null);
  const currentStep = steps[Math.max(0, Math.min(steps.length - 1, stepIndex))] ?? null;
  const crop = currentStep ? stepCrop(currentStep) : null;
  const manuals = layout === 'manuals';
  const spread = manuals && !listOpen && twoPages;
  const nextStep = spread ? steps[stepIndex + 1] : null;
  const fitMode = fitChoice?.url === currentStep?.pageUrl ? fitChoice?.mode
    : pageShape?.url === currentStep?.pageUrl && pageShape?.landscape ? 'width' : 'contain';
  const fitWidth = manuals && fitMode === 'width';
  const findSequenceDocument = useCallback((step: AssemblyProcedureSequenceStepDto) =>
    sequence.documents.find((document) =>
      step.kioskDocumentId
        ? document.kioskDocumentId === step.kioskDocumentId
        : document.assemblyProcedureDocumentId === step.assemblyProcedureDocumentId
    ), [sequence.documents]);
  const getStepPage = useCallback((step: AssemblyProcedureSequenceStepDto) => {
    const document = findSequenceDocument(step);
    return document
      ? getSequenceDocumentPages(document).find((page) => page.pageIndex === step.pageIndex) ?? null
      : null;
  }, [findSequenceDocument]);
  const getStepOverlays = useCallback((step: AssemblyProcedureSequenceStepDto): AssemblyProcedureOverlayElement[] => {
    const document = findSequenceDocument(step);
    const page = getStepPage(step);
    return page?.overlays ?? document?.overlays?.filter((element) => element.pageIndex === step.pageIndex) ?? [];
  }, [findSequenceDocument, getStepPage]);
  const getStepAssets = useCallback(
    (step: AssemblyProcedureSequenceStepDto) => findSequenceDocument(step)?.assets,
    [findSequenceDocument]
  );
  const currentSequencePage = useMemo(
    () => currentStep ? getStepPage(currentStep) : null,
    [currentStep, getStepPage]
  );
  const currentOverlays = useMemo(
    () => currentStep ? getStepOverlays(currentStep) : [],
    [currentStep, getStepOverlays]
  );
  const currentAssets = useMemo(
    () => currentStep ? getStepAssets(currentStep) : undefined,
    [currentStep, getStepAssets]
  );
  const currentPage = useMemo(
    () =>
      currentSequencePage ?? (currentStep
        ? {
            source: currentStep.documentType,
            documentId:
              currentStep.kioskDocumentId ?? currentStep.assemblyProcedureDocumentId!,
            pageIndex: currentStep.pageIndex,
            pageUrl: currentStep.pageUrl
          }
        : null),
    [currentSequencePage, currentStep]
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
    setStepIndex(initialStepIndex);
  }, [sequence.machineNameKey, initialDocumentId, initialStepIndex]);
  useEffect(() => {
    setStepIndex((current) => Math.max(0, Math.min(steps.length - 1, current)));
  }, [steps.length]);
  useEffect(() => {
    setShowFullPage(false);
    onCurrentPageChange?.(currentPage);
  }, [currentPage, onCurrentPageChange]);

  useEffect(() => {
    onCurrentStepChange?.(currentStep, stepIndex, steps.length);
  }, [currentStep, stepIndex, steps.length, onCurrentStepChange]);

  const jumpToCurrentMarker = () => {
    if (!currentMarker) return;
    const nextIndex = steps.findIndex((step) => stepMatchesMarker(step, currentMarker));
    if (nextIndex >= 0) setStepIndex(nextIndex);
  };

  if (!currentStep || !currentPage) {
    return (
      <div className={clsx(className, manuals && "relative pr-16")}>
        <div className="flex h-full min-h-[18rem] items-center justify-center bg-slate-950 text-sm font-semibold text-white/60">
          表示できる要領書ページがありません
        </div>
        {manuals ? <ProcedureManualPageRail listOpen={listOpen} onToggleList={onToggleList} /> : null}
      </div>
    );
  }

  const emphasisClass =
    currentStep.emphasis === 'caution'
      ? 'border-amber-300/50 bg-amber-950/55 text-amber-50'
      : currentStep.emphasis === 'important'
        ? 'border-rose-300/45 bg-rose-950/45 text-rose-50'
        : 'border-cyan-300/25 bg-cyan-950/35 text-cyan-50';

  const renderManualPage = (step: AssemblyProcedureSequenceStepDto, current: boolean) => {
    const pageCrop = current && showFullPage ? null : stepCrop(step);
    const elements = getStepOverlays(step);
    const assets = getStepAssets(step);
    if (pageCrop) return (
      <AssemblyProcedureCropView pageUrl={step.pageUrl} crop={pageCrop} className="h-full w-full" overlay={
        <>
          <AssemblyProcedureOverlayLayer elements={elements} crop={pageCrop} assets={assets} />
          {current ? <AssemblyProcedureMarkerLayer bolts={visibleBolts} checkItems={visibleChecks} selectedBoltId={selectedBoltId} inputTargetBoltId={inputTargetBoltId} onToggleCheckItem={onToggleCheckItem} /> : null}
        </>
      } />
    );
    return (
      <div key={step.pageUrl} className={clsx('h-full w-full', fitWidth ? 'overflow-y-auto' : 'overflow-hidden')} data-testid={current ? 'procedure-page-viewport' : undefined} data-fit-mode={fitMode}>
        <AssemblyProcedureImageWithMarkers
          fitToParent={!fitWidth}
          className={fitWidth ? '!block w-full' : 'h-full w-full'}
          imageContent={<KioskDocumentPageImage
            pageUrl={step.pageUrl}
            alt={current ? '' : '次ページ'}
            className={fitWidth ? 'block h-auto w-full' : 'h-full w-full object-contain'}
            onLoad={current ? event => {
              const image = event.currentTarget;
              if (image.naturalWidth && image.naturalHeight) setPageShape({ url: step.pageUrl, landscape: image.naturalWidth > image.naturalHeight });
            } : undefined}
          />}
          bolts={current ? boltMarkers : []}
          checkItems={current ? checkMarkers : []}
          selectedBoltId={selectedBoltId}
          inputTargetBoltId={inputTargetBoltId}
          onToggleCheckItem={onToggleCheckItem}
          overlay={<AssemblyProcedureOverlayLayer elements={elements} assets={assets} />}
        />
      </div>
    );
  };

  return (
    <div className={clsx('relative flex min-h-0 flex-col', manuals ? 'bg-[#0a0d10] pr-16' : 'bg-slate-950', className)}>
      {!manuals ? <header className="shrink-0 border-b border-white/10 bg-slate-900/90 px-2 py-1">
        <div
          className="grid min-h-12 grid-cols-[minmax(10rem,1fr)_minmax(4rem,0.45fr)_auto] items-center gap-2"
          data-testid="assembly-procedure-sequence-toolbar"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">
              手順 {stepIndex + 1}/{steps.length} · {currentStep.title || currentStep.documentTitle}
            </p>
            <p className="truncate text-xs text-white/50">
              {currentStep.documentTitle} / {currentStep.pageIndex + 1}ページ
            </p>
          </div>
          <div
            className="flex h-3 min-w-16 overflow-hidden rounded bg-slate-950"
            aria-label="文書区間の全体マップ"
          >
            {segments.map((segment, index) => (
              <button
                key={`${segment.key}:${segment.start}`}
                type="button"
                aria-label={`${segment.start + 1}手順目へ移動`}
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
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10 !px-2 text-xs"
              onClick={() => setStoryboardOpen((open) => !open)}
            >
              全手順
            </Button>
            {showCurrentMarkerButton ? <Button
              type="button"
              variant="ghostOnDark"
              className="min-h-10 !px-2 text-xs"
              disabled={!currentMarker}
              onClick={jumpToCurrentMarker}
            >
              現在の丸数字へ
            </Button> : null}
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
        {currentStep.title || currentStep.instructionText ? (
          <div className={clsx('mt-1 rounded border px-3 py-2', emphasisClass)}>
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
      </header> : null}
      <div className="flex min-h-0 flex-1">
        {storyboardOpen ? (
          <aside className="flex w-48 shrink-0 flex-col border-r border-white/10 bg-slate-900/75">
            <AssemblyWorkStepStoryboard
              steps={steps}
              currentIndex={stepIndex}
              currentStep={currentStep}
              boltMarkers={boltMarkers}
              checkMarkers={checkMarkers}
              inputTargetBoltId={inputTargetBoltId}
              onSelect={setStepIndex}
              getStepOverlays={getStepOverlays}
              getStepAssets={getStepAssets}
            />
          </aside>
        ) : null}
        <div
          className={clsx("relative min-h-0 min-w-0 flex-1 overflow-hidden", manuals ? "p-5" : "p-2")}
          data-testid="assembly-work-step-canvas"
        >
          {manuals ? (
            <div className="flex h-full min-w-0 gap-4" data-testid="procedure-page-spread" data-pages={spread ? 2 : 1}>
              <div className="relative h-full min-w-0 flex-1">{renderManualPage(currentStep, true)}</div>
              {spread ? <div className="h-full min-w-0 flex-1" data-testid="procedure-second-page">{nextStep ? renderManualPage(nextStep, false) : null}</div> : null}
            </div>
          ) : crop && !showFullPage ? (
            <AssemblyProcedureCropView
              pageUrl={currentStep.pageUrl}
              crop={crop}
              className="h-full w-full"
              overlay={
                <>
                  <AssemblyProcedureOverlayLayer
                    elements={currentOverlays}
                    crop={crop}
                    assets={currentAssets}
                  />
                  <AssemblyProcedureMarkerLayer
                    bolts={visibleBolts}
                    checkItems={visibleChecks}
                    selectedBoltId={selectedBoltId}
                    inputTargetBoltId={inputTargetBoltId}
                    onToggleCheckItem={onToggleCheckItem}
                  />
                </>
              }
            />
          ) : (
            <div className={clsx("h-full w-full", fitWidth ? "overflow-y-auto" : "overflow-hidden")} data-testid="procedure-page-viewport" >
            <AssemblyProcedureImageWithMarkers
              fitToParent={!fitWidth}
              className={fitWidth ? "!block w-full" : "h-full w-full"}
              imageContent={
                <KioskDocumentPageImage
                  pageUrl={currentStep.pageUrl}
                  alt=""
                  className={fitWidth ? "block h-auto w-full" : "h-full w-full object-contain"}

                />
              }
              bolts={boltMarkers}
              checkItems={checkMarkers}
              selectedBoltId={selectedBoltId}
              inputTargetBoltId={inputTargetBoltId}
              onToggleCheckItem={onToggleCheckItem}
              overlay={
                <AssemblyProcedureOverlayLayer
                  elements={currentOverlays}
                  assets={currentAssets}
                />
              }
            />
            </div>
          )}
          {crop ? (
            <div className={clsx("absolute right-3 grid w-32 gap-1", manuals ? "bottom-3" : "bottom-3")}>
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
      {manuals ? <ProcedureManualPageRail listOpen={listOpen} onToggleList={onToggleList} twoPages={spread} onToggleTwoPages={onToggleTwoPages} storyboardOpen={storyboardOpen} onToggleStoryboard={() => setStoryboardOpen(open => !open)} fitMode={fitMode} fitDisabled={Boolean(crop && !showFullPage)} onFit={mode => setFitChoice({ url: currentStep.pageUrl, mode })} index={stepIndex} total={steps.length} onPrevious={() => setStepIndex(index => Math.max(0, index - (spread ? 2 : 1)))} onNext={() => setStepIndex(index => Math.min(steps.length - 1, index + (spread ? 2 : 1)))} /> : null}
    </div>
  );
}

export type { AssemblyProcedureSequencePageDto };
