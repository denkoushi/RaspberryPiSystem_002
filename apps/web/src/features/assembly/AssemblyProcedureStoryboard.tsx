import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { useEffect, useMemo, useRef } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { AssemblyProcedureCropView } from './AssemblyProcedureCropView';
import {
  AssemblyProcedureMarkerLayer,
  type AssemblyCanvasBolt,
  type AssemblyCanvasCheckItem
} from './AssemblyProcedureMarkerLayer';
import { findPageForProcedureStep } from './assemblyProcedureStepDraft';

import type { AssemblyProcedureStepDraft } from './assemblyProcedureStepDraft';
import type { AssemblyEditorPageOption } from './assemblyTemplateDraft';

type Props = {
  steps: AssemblyProcedureStepDraft[];
  pages: AssemblyEditorPageOption[];
  selectedLocalId: string | null;
  readOnly?: boolean;
  onSelect: (localId: string) => void;
  onMove: (localId: string, delta: -1 | 1) => void;
  onMoveTo: (localId: string, targetIndex: number) => void;
  onDuplicate: (localId: string) => void;
  onRemove: (localId: string) => void;
  markerProjectionByStepId?: ReadonlyMap<
    string,
    { bolts: AssemblyCanvasBolt[]; checkItems: AssemblyCanvasCheckItem[] }
  >;
};

export function AssemblyProcedureStoryboard({
  steps,
  pages,
  selectedLocalId,
  readOnly = false,
  onSelect,
  onMove,
  onMoveTo,
  onDuplicate,
  onRemove,
  markerProjectionByStepId
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () =>
      steps
        .map((step, sourceIndex) => ({
          step,
          sourceIndex,
          page: findPageForProcedureStep(step, pages)
        })),
    [pages, steps]
  );
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 118,
    overscan: 5
  });
  useEffect(() => {
    if (!selectedLocalId) return;
    const visibleIndex = visible.findIndex(({ step }) => step.localId === selectedLocalId);
    if (visibleIndex >= 0) virtualizer.scrollToIndex(visibleIndex);
  }, [selectedLocalId, visible, virtualizer]);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="手順ストーリーボード">
      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto" data-testid="assembly-step-storyboard">
        <div className="relative min-w-0 w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = visible[virtualRow.index]!;
            const { step, sourceIndex, page } = item;
            const markerProjection = markerProjectionByStepId?.get(step.localId);
            return (
              <article
                key={step.localId}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 min-w-0 w-full p-1.5"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`手順${sourceIndex + 1}${step.title.trim() ? `: ${step.title.trim()}` : ''}`}
                  className={clsx(
                    'grid min-h-[106px] min-w-0 w-full gap-1 rounded border p-1 text-left',
                    'grid-cols-1',
                    selectedLocalId === step.localId
                      ? 'border-cyan-300 bg-cyan-950/55'
                      : 'border-white/10 bg-slate-950/65'
                  )}
                  onClick={() => onSelect(step.localId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(step.localId);
                    }
                  }}
                >
                  <div
                    className="relative h-24 overflow-hidden rounded bg-white"
                    data-testid="assembly-step-thumbnail"
                  >
                    {page ? (
                      <AssemblyProcedureCropView
                        pageUrl={page.imageRelativePath}
                        crop={step.crop}
                        className="h-full w-full"
                        overlay={
                          markerProjection ? (
                            <AssemblyProcedureMarkerLayer
                              bolts={markerProjection.bolts}
                              checkItems={markerProjection.checkItems}
                              density="compact"
                            />
                          ) : null
                        }
                      />
                    ) : null}
                    <span className="absolute left-1 top-1 rounded bg-slate-950/85 px-1 text-xs font-bold text-white">
                      {sourceIndex + 1}
                    </span>
                  </div>
                </div>
                <div className="mt-1 grid min-w-0 grid-cols-[2rem_2rem_3rem_minmax(0,1fr)_2rem_2rem] items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghostOnDark"
                    className="min-h-8 min-w-0 !px-1 !py-0.5 text-sm"
                    disabled={readOnly || sourceIndex === 0}
                    onClick={() => onMove(step.localId, -1)}
                    aria-label="前へ"
                    title="前へ"
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghostOnDark"
                    className="min-h-8 min-w-0 !px-1 !py-0.5 text-sm"
                    disabled={readOnly || sourceIndex === steps.length - 1}
                    onClick={() => onMove(step.localId, 1)}
                    aria-label="次へ"
                    title="次へ"
                  >
                    ↓
                  </Button>
                  <Input
                    aria-label={`手順${sourceIndex + 1}の移動先`}
                    className="h-8 min-w-0 w-full !px-1 text-center text-xs"
                    type="number"
                    min={1}
                    max={steps.length}
                    defaultValue={sourceIndex + 1}
                    disabled={readOnly}
                    onBlur={(event) =>
                      onMoveTo(step.localId, Number(event.currentTarget.value) - 1)
                    }
                  />
                  <span aria-hidden="true" />
                  <button
                    type="button"
                    className="min-h-8 shrink-0 rounded px-1 text-sm font-semibold text-white/60 hover:bg-white/10"
                    disabled={readOnly}
                    onClick={() => onDuplicate(step.localId)}
                    aria-label="複製"
                    title={`手順${sourceIndex + 1}を複製`}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="min-h-8 shrink-0 rounded px-1 text-lg font-semibold text-rose-200 hover:bg-rose-500/15"
                    disabled={readOnly}
                    onClick={() => onRemove(step.localId)}
                    aria-label="削除"
                    title={`手順${sourceIndex + 1}を削除`}
                  >
                    ×
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
