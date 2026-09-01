import {
  effectiveWorkInstructionMemo,
  memoOverridesToArray,
  workInstructionMemoNeedsAttention,
  workInstructionMemoNeedsReviewForStep
} from './workInstructionEditorMemo';
import { WorkInstructionMemoReviewIndicator } from './WorkInstructionMemoReviewIndicator';

import type { WorkInstructionEditorController } from './useWorkInstructionEditorController';

export function WorkInstructionEditorRowsPane({ controller }: { controller: WorkInstructionEditorController }) {
  return (
    <aside
      className="min-h-0 overflow-auto border-b border-white/10 bg-slate-900/70 p-2 xl:border-b-0 xl:border-r"
      aria-label="要領書の原本行"
    >
      <h2 className="mb-2 text-xs font-bold text-white/70">原本行</h2>
      <div className="grid gap-1">
        {controller.rows.map((row) => {
          const currentOverrides = row.draft ? controller.memoOverridesByRevision?.[row.draft.id] : undefined;
          const memoOverrides = currentOverrides === undefined
            ? row.draft?.memoOverrides
            : memoOverridesToArray(currentOverrides);
          const hasMemoReview = workInstructionMemoNeedsAttention(memoOverrides);
          return (
            <button
              key={row.rowId}
              type="button"
              className={`rounded border px-2 py-2 text-left text-xs ${
                row.rowId === controller.selectedRowId
                  ? 'border-cyan-300 bg-cyan-300/15 text-white'
                  : 'border-white/10 text-white/75 hover:bg-white/10'
              }`}
              onClick={() => controller.selectRow(row.rowId)}
            >
              <span className="flex items-center justify-between gap-2 font-bold">
                <span>{row.source.system} / {row.source.list}</span>
                {hasMemoReview ? (
                  <WorkInstructionMemoReviewIndicator
                    label={`メモ要確認（原本行 ${row.rowId}）`}
                    testId={`work-instruction-editor-row-memo-review-${row.rowId}`}
                  />
                ) : null}
              </span>
              <span className="block text-white/60">item {row.source.itemId}</span>
              {row.updateAvailable ? <span className="mt-1 block text-amber-200">新原本あり</span> : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded border border-white/10 p-2 text-xs text-white/75">
        <p className="font-bold text-white">移植集計</p>
        <p>総数 {controller.group?.migration.total ?? 0}</p>
        <p>移植済み {controller.group?.migration.migrated ?? 0}</p>
        <p className="text-amber-100">要確認 {controller.group?.migration.needsReview ?? 0}</p>
        <p>未割当 {controller.group?.migration.unassigned ?? 0}</p>
      </div>
    </aside>
  );
}

export function WorkInstructionEditorStepsPane({ controller }: { controller: WorkInstructionEditorController }) {
  const memoOverrides = controller.activeMemoOverridesArray;
  return (
    <aside
      className="min-h-0 overflow-auto border-b border-white/10 bg-slate-900/50 p-2 xl:border-b-0 xl:border-r"
      aria-label="手順一覧"
    >
      <h2 className="mb-2 text-xs font-bold text-white/70">手順</h2>
      <div className="grid gap-1">
        {controller.activeSteps.map((step, index) => {
          const key = step.stepKey || `${step.sourceSystem}:${step.sourceList}:${step.sourceItemId}:${step.step}`;
          const hasMemoReview = workInstructionMemoNeedsReviewForStep(key, memoOverrides);
          return (
            <button
              key={key}
              type="button"
              className={`rounded border px-2 py-2 text-left text-xs ${
                key === controller.selectedStepKey
                  ? 'border-emerald-300 bg-emerald-300/15 text-white'
                  : 'border-white/10 text-white/75 hover:bg-white/10'
              }`}
              onClick={() => controller.selectStep(key)}
            >
              <span className="flex items-center justify-between gap-2 font-bold">
                <span>手順 {step.step || index + 1}</span>
                {hasMemoReview ? (
                  <WorkInstructionMemoReviewIndicator
                    label={`メモ要確認（手順 ${step.step || index + 1}）`}
                    testId={`work-instruction-editor-step-memo-review-${key}`}
                  />
                ) : null}
              </span>
              <span className="mt-1 block truncate text-white/60">{effectiveWorkInstructionMemo(step, controller.activeMemoOverrides)}</span>
              <span className="mt-1 block text-white/50">
                注記 {controller.activeElements.filter((element) => element.stepKey === key).length}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
