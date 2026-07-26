import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { useMemo, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { AssemblyProcedureCropView } from './AssemblyProcedureCropView';
import {
  assemblyProcedureStepDocumentKey,
  findPageForProcedureStep
} from './assemblyProcedureStepDraft';

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
};

const emphasisLabel = {
  normal: '標準',
  important: '重要',
  caution: '注意'
} as const;

export function AssemblyProcedureStoryboard({
  steps,
  pages,
  selectedLocalId,
  readOnly = false,
  onSelect,
  onMove,
  onMoveTo,
  onDuplicate,
  onRemove
}: Props) {
  const [search, setSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const normalizedSearch = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      steps
        .map((step, sourceIndex) => ({
          step,
          sourceIndex,
          page: findPageForProcedureStep(step, pages)
        }))
        .filter(({ step, page }) => {
          if (!normalizedSearch) return true;
          return [step.title, step.instructionText, emphasisLabel[step.emphasis], page?.label]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearch);
        }),
    [normalizedSearch, pages, steps]
  );
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 118,
    overscan: 5
  });
  const segments = useMemo(() => {
    const result: Array<{ key: string; start: number; count: number }> = [];
    for (const step of steps) {
      const key = assemblyProcedureStepDocumentKey(step);
      const last = result.at(-1);
      if (last?.key === key) last.count += 1;
      else result.push({ key, start: result.reduce((sum, item) => sum + item.count, 0), count: 1 });
    }
    return result;
  }, [steps]);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="手順ストーリーボード">
      <div className="shrink-0 border-b border-white/10 p-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">手順 {steps.length}/300</h2>
          <span className="text-[0.65rem] text-white/50">表示カード30件以下</span>
        </div>
        <Input
          aria-label="手順検索"
          className="mt-2 min-h-10 text-sm"
          placeholder="文書名・タイトル・指示・重要度"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mt-2 flex h-5 overflow-hidden rounded bg-slate-950" aria-label="文書区間の全体マップ">
          {segments.map((segment, index) => (
            <button
              key={`${segment.key}:${segment.start}`}
              type="button"
              title={`区間${index + 1}: ${segment.count}手順`}
              className={clsx(
                'min-w-1 border-r border-slate-950',
                index % 3 === 0 && 'bg-cyan-500',
                index % 3 === 1 && 'bg-violet-500',
                index % 3 === 2 && 'bg-emerald-500'
              )}
              style={{ flexGrow: segment.count }}
              onClick={() => {
                const visibleIndex = visible.findIndex(
                  (item) => item.sourceIndex === segment.start
                );
                if (visibleIndex >= 0) virtualizer.scrollToIndex(visibleIndex);
                onSelect(steps[segment.start]!.localId);
              }}
            />
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" data-testid="assembly-step-storyboard">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = visible[virtualRow.index]!;
            const { step, sourceIndex, page } = item;
            return (
              <article
                key={step.localId}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full p-1.5"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className={clsx(
                    'grid min-h-[106px] w-full grid-cols-[4.25rem_minmax(0,1fr)] gap-2 rounded border p-2 text-left',
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
                  <div className="relative h-16 overflow-hidden rounded bg-white">
                    {page ? (
                      <AssemblyProcedureCropView
                        pageUrl={page.imageRelativePath}
                        crop={step.crop}
                        className="h-full w-full"
                      />
                    ) : null}
                    <span className="absolute left-1 top-1 rounded bg-slate-950/85 px-1 text-xs font-bold text-white">
                      {sourceIndex + 1}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold">
                      {step.title.trim() || page?.label || `手順 ${sourceIndex + 1}`}
                    </p>
                    <p className="mt-1 truncate text-[0.65rem] text-white/55">
                      P{step.pageIndex + 1} · {step.viewMode === 'crop' ? '矩形' : '全体'} ·{' '}
                      {emphasisLabel[step.emphasis]}
                    </p>
                    <div className="mt-1 flex gap-1">
                      <Button
                        type="button"
                        variant="ghostOnDark"
                        className="min-h-8 !px-1.5 !py-0.5 text-[0.65rem]"
                        disabled={readOnly || sourceIndex === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMove(step.localId, -1);
                        }}
                      >
                        前へ
                      </Button>
                      <Button
                        type="button"
                        variant="ghostOnDark"
                        className="min-h-8 !px-1.5 !py-0.5 text-[0.65rem]"
                        disabled={readOnly || sourceIndex === steps.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMove(step.localId, 1);
                        }}
                      >
                        次へ
                      </Button>
                      <Input
                        aria-label={`手順${sourceIndex + 1}の移動先`}
                        className="h-8 w-12 !px-1 text-center text-xs"
                        type="number"
                        min={1}
                        max={steps.length}
                        defaultValue={sourceIndex + 1}
                        disabled={readOnly}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={(event) =>
                          onMoveTo(step.localId, Number(event.currentTarget.value) - 1)
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex justify-end gap-1">
                  <button
                    type="button"
                    className="min-h-8 rounded px-2 text-[0.65rem] font-semibold text-white/60 hover:bg-white/10"
                    disabled={readOnly}
                    onClick={() => onDuplicate(step.localId)}
                  >
                    複製
                  </button>
                  <button
                    type="button"
                    className="min-h-8 rounded px-2 text-[0.65rem] font-semibold text-rose-200 hover:bg-rose-500/15"
                    disabled={readOnly}
                    onClick={() => onRemove(step.localId)}
                  >
                    削除
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
