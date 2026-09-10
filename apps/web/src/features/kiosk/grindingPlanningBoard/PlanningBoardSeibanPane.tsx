import clsx from 'clsx';
import { memo, useMemo } from 'react';

import { normalizeMachineName } from '../productionSchedule/machineName';

import { PlanningBoardItemTable } from './PlanningBoardItemTable';
import { resolveGrindingPlanningBoardDueDate } from './sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const formatDate = (date: string | null): string => (date ? date.slice(5).replace('-', '/') : '未定');

export type PlanningBoardSeibanPaneProps = {
  fseiban: string;
  machineName: string | null;
  items: readonly GrindingPlanningBoardItem[];
  allocation: PlanningBoardAllocation;
  selectedItemIds: ReadonlySet<string>;
  isOpen: boolean;
  isFocused: boolean;
  onToggleOpen: () => void;
  onFocus: () => void;
  onToggleAll: (selected: boolean) => void;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  disabled?: boolean;
  rankDisabled?: boolean;
  bulkDisabled?: boolean;
};

function areSelectionStatesEqual(
  items: readonly GrindingPlanningBoardItem[],
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>
): boolean {
  if (previous === next) return true;
  return items.every((item) => previous.has(item.itemId) === next.has(item.itemId));
}

function arePanePropsEqual(
  previous: PlanningBoardSeibanPaneProps,
  next: PlanningBoardSeibanPaneProps
): boolean {
  return previous.fseiban === next.fseiban &&
    previous.machineName === next.machineName &&
    previous.items === next.items &&
    previous.allocation === next.allocation &&
    previous.isOpen === next.isOpen &&
    previous.isFocused === next.isFocused &&
    previous.onToggleOpen === next.onToggleOpen &&
    previous.onFocus === next.onFocus &&
    previous.onToggleAll === next.onToggleAll &&
    previous.onToggleItem === next.onToggleItem &&
    previous.onResourceClick === next.onResourceClick &&
    previous.onRankChange === next.onRankChange &&
    previous.disabled === next.disabled &&
    previous.bulkDisabled === next.bulkDisabled &&
    areSelectionStatesEqual(previous.items, previous.selectedItemIds, next.selectedItemIds);
}

export const PlanningBoardSeibanPane = memo(function PlanningBoardSeibanPane({
  fseiban,
  machineName,
  items,
  allocation,
  selectedItemIds,
  isOpen,
  isFocused,
  onToggleOpen,
  onFocus,
  onToggleAll,
  onToggleItem,
  onResourceClick,
  onRankChange,
  disabled = false,
  rankDisabled = false,
  bulkDisabled = false
}: PlanningBoardSeibanPaneProps) {
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
  const displayMachineName = normalizeMachineName(machineName);

  return (
    <article
      className={clsx(
        'min-w-0 overflow-hidden rounded-lg border bg-slate-900/85',
        isFocused ? 'border-emerald-400/70 shadow-lg shadow-emerald-950/30' : 'border-slate-800'
      )}
      data-testid={`planning-board-seiban-${fseiban}`}
    >
      <div className={clsx('flex min-h-14 min-w-0 items-center gap-2 border-b border-slate-800 px-2.5 py-2', isFocused && 'bg-slate-800/70')}>
        <button
          type="button"
          className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          aria-expanded={isOpen}
          aria-label={`製番${fseiban}の明細を${isOpen ? '閉じる' : '開く'}`}
          disabled={disabled}
          onClick={onToggleOpen}
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <strong className="shrink-0 font-mono text-sm text-white">{fseiban}</strong>
            <span className="min-w-0 truncate text-xs text-slate-300">{displayMachineName || '機種名未登録'}</span>
          </span>
          <span className="mt-1 block text-[11px] text-slate-400">{formatDate(nearestDue)}</span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="grid min-h-11 min-w-11 place-items-center rounded-md text-lg text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
            aria-label={`製番${fseiban}${isFocused ? 'を一覧に戻す' : 'を広げる'}`}
            disabled={disabled}
            onClick={onFocus}
          >
            {isFocused ? '⤡' : '⤢'}
          </button>
          <label className="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-slate-800" title="全選択">
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
        </div>
      </div>
      {isOpen ? (
        <PlanningBoardItemTable
          items={items}
          allocation={allocation}
          selectedItemIds={selectedItemIds}
          onToggleItem={onToggleItem}
          onResourceClick={onResourceClick}
          onRankChange={onRankChange}
          disabled={disabled}
          rankDisabled={rankDisabled}
          showColumnHeaders={false}
          tableLabel={`${fseiban}の工程アイテム`}
        />
      ) : null}
    </article>
  );
}, arePanePropsEqual);
