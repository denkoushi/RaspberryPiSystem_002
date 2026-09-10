import clsx from 'clsx';
import { memo } from 'react';


import {
  resolveGrindingPlanningBoardDueDate,
  resolveGrindingPlanningBoardResource
} from './sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const formatDate = (date: string | null): string => (date ? date.slice(5).replace('-', '/') : '未定');

const rankOptions = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type PlanningBoardItemTableProps = {
  items: readonly GrindingPlanningBoardItem[];
  allocation: PlanningBoardAllocation;
  selectedItemIds: ReadonlySet<string>;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  showRank?: boolean;
  showSeiban?: boolean;
  showColumnHeaders?: boolean;
  disabled?: boolean;
  tableLabel: string;
};

type PlanningBoardItemTableRowProps = {
  item: GrindingPlanningBoardItem;
  allocation: PlanningBoardAllocation;
  selected: boolean;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  showRank: boolean;
  showSeiban: boolean;
  disabled: boolean;
};

const PlanningBoardItemTableRow = memo(function PlanningBoardItemTableRow({
  item,
  allocation,
  selected,
  onToggleItem,
  onResourceClick,
  onRankChange,
  showRank,
  showSeiban,
  disabled
}: PlanningBoardItemTableRowProps) {
  const currentResource = resolveGrindingPlanningBoardResource(item, allocation);
  const currentDue = resolveGrindingPlanningBoardDueDate(item, allocation);
  const rank = allocation === 'alternate' ? item.alternateRank : item.originalRank;
  const plannedQuantity = item.plannedQuantity == null ? '—' : `${item.plannedQuantity}個`;
  const requiredTime = item.requiredMinutesKnown && item.requiredMinutes != null
    ? `${item.requiredMinutes}分`
    : '時間未定';

  return (
    <tr
      key={item.itemId}
      data-testid={`planning-board-item-${item.itemId}`}
      className={clsx('border-b border-slate-800/80', item.isCompleted && 'opacity-55')}
    >
      <td className="px-1 align-middle">
        <label className="grid min-h-11 w-full place-items-center">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-emerald-400"
            checked={selected}
            disabled={disabled || item.isCompleted}
            aria-label={`${item.fhinmei ?? item.fhincd}を選択`}
            onChange={(event) => onToggleItem(item, event.target.checked)}
          />
        </label>
      </td>
      <td className="min-w-0 px-1 py-1 align-middle">
        {showSeiban ? (
          <div className="min-w-0 text-white">
            <div className="min-w-0 leading-tight">
              <span className="break-words font-semibold [overflow-wrap:anywhere]">{item.fhinmei || '部品名未登録'}</span>
              <span className="ml-1 whitespace-nowrap text-[10px] text-white">{plannedQuantity} · {requiredTime}</span>
            </div>
            <div className="mt-0.5 break-words font-mono text-[10px] text-white [overflow-wrap:anywhere]">
              {item.fseiban} · {item.fhincd || item.productNo}
            </div>
          </div>
        ) : (
          <>
            <span className="block break-words font-semibold leading-tight text-slate-100 [overflow-wrap:anywhere]">
              {item.fhinmei || '部品名未登録'}
            </span>
            <span className="mt-0.5 block break-words font-mono text-[10px] text-slate-400 [overflow-wrap:anywhere]">{item.fhincd || item.productNo}</span>
            {showRank ? (
              <span className="mt-0.5 block break-words text-[10px] leading-tight text-slate-400 [overflow-wrap:anywhere]">
                {plannedQuantity} · {requiredTime}
              </span>
            ) : null}
          </>
        )}
      </td>
      <td className="px-1 align-middle">
        <button
          type="button"
          className={clsx(
            'inline-flex min-h-11 min-w-11 max-w-full items-center justify-center rounded-md border px-1 font-mono font-bold',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300',
            showSeiban
              ? allocation === 'alternate' &&
                item.effectiveResourceCd != null &&
                item.effectiveResourceCd !== item.originalResourceCd
                ? 'border-amber-300/60 bg-amber-950/50 text-[15px] text-white'
                : 'border-slate-700 bg-slate-900 text-[15px] text-white hover:border-indigo-300'
              : allocation === 'alternate' &&
                item.effectiveResourceCd != null &&
                item.effectiveResourceCd !== item.originalResourceCd
                ? 'border-amber-300/60 bg-amber-950/50 text-[10px] text-amber-200'
                : 'border-slate-700 bg-slate-900 text-[10px] text-indigo-300 hover:border-indigo-300',
            (allocation === 'original' || item.isCompleted) && 'cursor-not-allowed opacity-60 hover:border-slate-700'
          )}
          aria-label={`資源CD ${currentResource ?? '未設定'}を変更`}
          disabled={disabled || allocation === 'original' || item.isCompleted}
          onClick={() => onResourceClick(item)}
        >
          {currentResource ?? '—'}
        </button>
      </td>
      <td className="px-1 py-1 align-middle">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
          <span className="whitespace-nowrap text-[10px] text-slate-300">{formatDate(currentDue)}</span>
          {!showRank ? (
            <>
              <span className="whitespace-nowrap text-[10px] text-slate-200">{plannedQuantity}</span>
              <span className="whitespace-nowrap text-[10px] text-slate-400">
                {requiredTime}
              </span>
            </>
          ) : null}
          {showRank ? (
            <select
              value={rank == null ? '' : String(rank)}
              disabled={disabled || allocation === 'original' || item.isCompleted || !onRankChange}
              aria-label={`${item.fhinmei ?? item.fhincd}の個別指定`}
              className="min-h-11 w-11 rounded-md border border-slate-700 bg-slate-950 px-0.5 text-center text-[10px] text-slate-200 disabled:cursor-not-allowed disabled:opacity-55"
              onChange={(event) => onRankChange?.(item, event.target.value ? Number(event.target.value) : null)}
            >
              {rankOptions.map((option) => (
                <option key={option ?? 'none'} value={option ?? ''}>
                  {option == null ? '－' : option}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </td>
    </tr>
  );
});

function areSelectionStatesEqual(
  items: readonly GrindingPlanningBoardItem[],
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>
): boolean {
  if (previous === next) return true;
  return items.every((item) => previous.has(item.itemId) === next.has(item.itemId));
}

function areTablePropsEqual(previous: PlanningBoardItemTableProps, next: PlanningBoardItemTableProps): boolean {
  return previous.items === next.items &&
    previous.allocation === next.allocation &&
    previous.onToggleItem === next.onToggleItem &&
    previous.onResourceClick === next.onResourceClick &&
    previous.onRankChange === next.onRankChange &&
    previous.showRank === next.showRank &&
    previous.showSeiban === next.showSeiban &&
    previous.showColumnHeaders === next.showColumnHeaders &&
    previous.disabled === next.disabled &&
    previous.tableLabel === next.tableLabel &&
    areSelectionStatesEqual(previous.items, previous.selectedItemIds, next.selectedItemIds);
}

export const PlanningBoardItemTable = memo(function PlanningBoardItemTable({
  items,
  allocation,
  selectedItemIds,
  onToggleItem,
  onResourceClick,
  onRankChange,
  showRank = false,
  showSeiban = false,
  showColumnHeaders = true,
  disabled = false,
  tableLabel
}: PlanningBoardItemTableProps) {
  return (
    <div className="min-w-0 overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left text-[11px] text-slate-300">
        <caption className="sr-only">{tableLabel}</caption>
        <colgroup>
          <col className="w-7" />
          <col />
          <col className="w-[3.25rem]" />
          <col className={showRank ? 'w-[6.5rem]' : 'w-12 xl:w-[6.5rem]'} />
        </colgroup>
        {showColumnHeaders ? (
          <thead>
            <tr className="h-8 border-b border-slate-800 text-[10px] font-medium tracking-wide text-slate-500">
              <th scope="col" className="px-0.5">選択</th>
              <th scope="col" className="px-1">部品名 / 図番</th>
              <th scope="col" className="px-1">資源</th>
              <th scope="col" className="px-1">日付 / 指示</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {items.map((item) => {
            const selected = selectedItemIds.has(item.itemId);
            return (
              <PlanningBoardItemTableRow
                key={item.itemId}
                item={item}
                allocation={allocation}
                selected={selected}
                onToggleItem={onToggleItem}
                onResourceClick={onResourceClick}
                onRankChange={onRankChange}
                showRank={showRank}
                showSeiban={showSeiban}
                disabled={disabled}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}, areTablePropsEqual);
