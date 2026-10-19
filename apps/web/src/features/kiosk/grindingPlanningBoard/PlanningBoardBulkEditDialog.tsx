import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

import { formatPlanningBoardLoadSummary, formatPlanningBoardResourceLoad } from './planningBoardLoad';
import { addUtcDays, displayedDue, shortDate, todayJst } from './planningBoardPageModel';
import { resolveGrindingPlanningBoardResource } from './sortGrindingPlanningBoardItems';

import type { DueMode, ResourceChoice } from './planningBoardPageModel';
import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardLoadResponse, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';

type Props = {
  editorOpen: boolean;
  editorPending: boolean;
  setEditorOpen: (open: boolean) => void;
  editorItems: GrindingPlanningBoardItem[];
  editorError: string | null;
  editorConflict: boolean;
  refreshAfterConflict: () => Promise<void>;
  allocation: PlanningBoardAllocation;
  writeBlocked: boolean;
  editorSnapshot: { resources: string[] } | null;
  canMoveResource: (item: GrindingPlanningBoardItem, target: string) => boolean;
  data: Pick<GrindingPlanningBoardResponse, 'resourceCategories'> | undefined;
  resourceChoice: ResourceChoice;
  setResourceChoice: (choice: ResourceChoice) => void;
  loadQuery: { data: GrindingPlanningBoardLoadResponse | undefined };
  dueMode: DueMode;
  setDueMode: (mode: DueMode) => void;
  dueDate: string;
  setDueDate: (date: string) => void;
  offsetDays: string;
  setOffsetDays: (days: string) => void;
  applyEditor: () => Promise<void>;
};

export function PlanningBoardBulkEditDialog({
  editorOpen, editorPending, setEditorOpen, editorItems, editorError, editorConflict, refreshAfterConflict,
  allocation, writeBlocked, editorSnapshot, canMoveResource, data, resourceChoice, setResourceChoice,
  loadQuery, dueMode, setDueMode, dueDate, setDueDate, offsetDays, setOffsetDays, applyEditor
}: Props) {
  const previewDue = (item: GrindingPlanningBoardItem) => {
    const before = displayedDue(item, allocation);
    const base = before ?? todayJst();
    if (dueMode === 'date') return `${shortDate(before)} → ${shortDate(dueDate)}`;
    if (dueMode === 'offsetDays') {
      const offset = Number(offsetDays);
      return Number.isInteger(offset) && offset >= 1
        ? `${shortDate(before)} → ${shortDate(addUtcDays(base, offset))}`
        : `${shortDate(before)} → 入力エラー`;
    }
    if (dueMode === 'restore') return `${shortDate(before)} → ${shortDate(item.originalDueDate)}`;
    return `${shortDate(before)} → 変更なし`;
  };

  const editorResources = (editorSnapshot?.resources ?? []).filter((resource) => editorItems.every((item) => canMoveResource(item, resource)));
  const editorMixedCategories = new Set(editorItems.map((item) => data?.resourceCategories?.[item.originalResourceCd ?? '']).filter(Boolean)).size > 1;
  const projectedLoad = (resource: string) => {
    const summary = loadQuery.data?.load.find((entry) => entry.resourceCd === resource);
    const base = allocation === 'original' ? summary?.originalRequiredMinutes : summary?.alternateRequiredMinutes;
    const baseUnknown = allocation === 'original' ? summary?.originalUnknownItemCount : summary?.alternateUnknownItemCount;
    let delta = 0;
    let unknownDelta = 0;
    for (const item of editorItems) {
      const current = resolveGrindingPlanningBoardResource(item, allocation);
      const target = resourceChoice === 'restore'
        ? item.originalResourceCd
        : resourceChoice === 'unchanged' ? current : resourceChoice;
      if (item.requiredMinutesKnown && item.requiredMinutes != null) {
        if (current === resource) delta -= item.requiredMinutes;
        if (target === resource) delta += item.requiredMinutes;
      } else {
        if (current === resource) unknownDelta -= 1;
        if (target === resource) unknownDelta += 1;
      }
    }
    const known = Math.max(0, (base ?? 0) + delta);
    const unknown = Math.max(0, (baseUnknown ?? 0) + unknownDelta);
    return formatPlanningBoardLoadSummary(known, unknown);
  };

  return (
      <Dialog isOpen={editorOpen} onClose={() => setEditorOpen(false)} title="一括変更" size="lg">
        <div className="mt-4 space-y-4">
          <p className="text-sm font-semibold text-slate-800">対象 {editorItems.length}件</p>
          {editorError ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{editorError}</p> : null}
          {editorConflict ? <Button type="button" variant="secondary" onClick={() => void refreshAfterConflict()}>最新状態を取得して閉じる</Button> : null}
          {allocation === 'original' ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">元データ表示中は変更できません。別割当に切り替えてください。</p> : null}
          <fieldset disabled={allocation === 'original' || writeBlocked}>
            <legend className="text-sm font-semibold text-slate-800">資源CD</legend>
            {editorMixedCategories && <p className="mt-2 text-sm text-slate-600">研削と切削が混ざっているため変更できません</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={`min-h-11 rounded-md border px-3 text-sm ${resourceChoice === 'unchanged' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setResourceChoice('unchanged')}>変更なし</button>
              <button type="button" className={`min-h-11 rounded-md border px-3 text-sm ${resourceChoice === 'restore' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setResourceChoice('restore')}>元に戻す</button>
              {editorResources.map((resource) => {
                const summary = loadQuery.data?.load.find((entry) => entry.resourceCd === resource);
                return (
                  <button
                    key={resource}
                    type="button"
                    aria-label={`資源CD ${resource}へ変更`}
                    className={`min-h-11 rounded-md border px-2 text-left font-mono text-sm ${resourceChoice === resource ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`}
                    onClick={() => setResourceChoice(resource)}
                  >
                    <span className="block">{resource}</span>
                    <span className="block text-[10px] font-sans opacity-75">{loadQuery.data ? formatPlanningBoardResourceLoad(summary, allocation) : '…'}</span>
                  </button>
                );
              })}
            </div>
            {loadQuery.data && resourceChoice !== 'unchanged' ? (
              <p className="mt-2 text-xs text-slate-600">
                {resourceChoice === 'restore'
                  ? `復帰後負荷: ${[...new Set(editorItems.map((item) => item.originalResourceCd).filter((resource): resource is string => Boolean(resource)))].map((resource) => `${resource} ${projectedLoad(resource)}`).join(' / ') || '0分'}`
                  : `移動後負荷: ${projectedLoad(resourceChoice)}`}
              </p>
            ) : null}
          </fieldset>
          <fieldset disabled={allocation === 'original' || writeBlocked}>
            <legend className="text-sm font-semibold text-slate-800">日付</legend>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className={`min-h-11 rounded-md border px-3 ${dueMode === 'none' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setDueMode('none')}>変更なし</button>
              <button type="button" className={`min-h-11 rounded-md border px-3 ${dueMode === 'restore' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setDueMode('restore')}>元に戻す</button>
              <button type="button" className={`min-h-11 rounded-md border px-3 ${dueMode === 'date' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setDueMode('date')}>指定日</button>
              <input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); setDueMode('date'); }} className="min-h-11 rounded-md border border-slate-300 px-2" />
              <button type="button" className={`min-h-11 rounded-md border px-3 ${dueMode === 'offsetDays' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setDueMode('offsetDays')}>+暦日</button>
              <input type="number" min="1" step="1" value={offsetDays} onChange={(event) => { setOffsetDays(event.target.value); setDueMode('offsetDays'); }} className="min-h-11 w-20 rounded-md border border-slate-300 px-2" aria-label="加算日数" />
            </div>
          </fieldset>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {editorItems.slice(0, 4).map((item) => <div key={item.itemId}>{item.fseiban} · {item.fhinmei || item.fhincd} / {previewDue(item)}</div>)}
            {editorItems.length > 4 ? <div>ほか {editorItems.length - 4}件</div> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>キャンセル</Button>
            <Button type="button" variant="primary" busy={editorPending} disabled={allocation === 'original' || writeBlocked || (resourceChoice === 'unchanged' && dueMode === 'none')} onClick={() => void applyEditor()}>{writeBlocked ? '適用中…' : '適用'}</Button>
          </div>
        </div>
      </Dialog>
  );
}
