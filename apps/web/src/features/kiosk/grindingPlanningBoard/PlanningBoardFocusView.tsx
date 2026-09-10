import clsx from 'clsx';
import { useMemo } from 'react';

import { normalizeMachineName } from '../productionSchedule/machineName';

import { PlanningBoardItemTable } from './PlanningBoardItemTable';
import { resolveGrindingPlanningBoardDueDate } from './sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const formatDate = (date: string | null): string => (date ? date.slice(5).replace('-', '/') : '未定');

export type PlanningBoardFocusViewProps = {
  fseiban: string;
  machineName: string | null;
  items: readonly GrindingPlanningBoardItem[];
  allocation: PlanningBoardAllocation;
  selectedItemIds: ReadonlySet<string>;
  onBack: () => void;
  onToggleAll: (selected: boolean) => void;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  disabled?: boolean;
  rankDisabled?: boolean | ((item: GrindingPlanningBoardItem) => boolean);
  bulkDisabled?: boolean;
};

export function PlanningBoardFocusView({
  fseiban,
  machineName,
  items,
  allocation,
  selectedItemIds,
  onBack,
  onToggleAll,
  onToggleItem,
  onResourceClick,
  onRankChange,
  disabled = false,
  rankDisabled = false,
  bulkDisabled = false
}: PlanningBoardFocusViewProps) {
  const selectableItems = useMemo(() => items.filter((item) => !item.isCompleted), [items]);
  const selectedSelectableCount = useMemo(
    () => selectableItems.filter((item) => selectedItemIds.has(item.itemId)).length,
    [selectableItems, selectedItemIds]
  );
  const allSelected = selectableItems.length > 0 && selectedSelectableCount === selectableItems.length;
  const someSelected = selectedSelectableCount > 0 && !allSelected;
  const nearestDue = useMemo(() => items
    .map((item) => resolveGrindingPlanningBoardDueDate(item, allocation))
    .filter((date): date is string => Boolean(date))
    .sort()[0] ?? null, [allocation, items]);
  const columns = useMemo(() => {
    const splitAt = Math.ceil(items.length / 2);
    return [items.slice(0, splitAt), items.slice(splitAt)].filter((column) => column.length > 0);
  }, [items]);
  const displayMachineName = normalizeMachineName(machineName);

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-emerald-400/70 bg-slate-900/90 shadow-lg shadow-emerald-950/30" data-testid="planning-board-focus-view">
      <header className="flex min-h-12 min-w-0 items-center gap-2 border-b border-slate-800 bg-slate-800/70 px-2.5 py-1">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <strong className="shrink-0 font-mono text-sm text-white">{fseiban}</strong>
            <span className="min-w-0 truncate text-xs text-slate-300">{displayMachineName || '機種名未登録'}</span>
            <span className="shrink-0 text-[11px] text-slate-400">{formatDate(nearestDue)}</span>
          </div>
        </div>
        <button
          type="button"
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-md text-lg text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
          aria-label={`製番${fseiban}を一覧に戻す`}
          onClick={onBack}
        >
          ⤡
        </button>
        <label className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-md hover:bg-slate-700" title="全選択">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-emerald-400"
            checked={allSelected}
            ref={(element) => {
              if (element) element.indeterminate = someSelected;
            }}
            disabled={disabled || bulkDisabled || selectableItems.length === 0}
            aria-label={`製番${fseiban}を全選択`}
            onChange={(event) => onToggleAll(event.target.checked)}
          />
        </label>
      </header>
      <div className={clsx('grid min-w-0 gap-3 p-1', columns.length > 1 ? 'lg:grid-cols-2' : 'grid-cols-1')}>
        {columns.map((column, index) => (
          <PlanningBoardItemTable
            key={`${fseiban}-focus-${index}`}
            items={column}
            allocation={allocation}
            selectedItemIds={selectedItemIds}
            onToggleItem={onToggleItem}
            onResourceClick={onResourceClick}
            onRankChange={onRankChange}
            disabled={disabled}
            rankDisabled={rankDisabled}
            showRank
            showColumnHeaders={false}
            tableLabel={`${fseiban}集中表示 ${index + 1}`}
          />
        ))}
      </div>
    </section>
  );
}
