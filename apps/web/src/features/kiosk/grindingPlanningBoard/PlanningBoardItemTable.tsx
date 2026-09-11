import clsx from 'clsx';
import { memo, useId, useRef, useState } from 'react';

import { LeaderBoardRankPickerDropdown } from '../leaderOrderBoard/LeaderBoardRankPickerDropdown';
import { normalizeMachineName } from '../productionSchedule/machineName';

import {
  resolveGrindingPlanningBoardDueDate,
  resolveGrindingPlanningBoardResource
} from './sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardSpecialDueKind } from '@raspi-system/shared-types';

const formatDate = (date: string | null): string => (date ? date.slice(5).replace('-', '/') : '未定');

const rankOptions = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type PlanningBoardItemTableProps = {
  items: readonly GrindingPlanningBoardItem[];
  allocation: PlanningBoardAllocation;
  selectedItemIds: ReadonlySet<string>;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  onSpecialDueClick?: (item: GrindingPlanningBoardItem) => void;
  specialDueMode?: GrindingPlanningBoardSpecialDueKind | null;
  nowMs?: number;
  showRank?: boolean;
  showSeiban?: boolean;
  showColumnHeaders?: boolean;
  seibanRankByFseiban?: ReadonlyMap<string, number>;
  disabled?: boolean;
  rankDisabled?: boolean | ((item: GrindingPlanningBoardItem) => boolean);
  resourceDragDisabled?: boolean;
  onResourcePointerDown?: (
    event: React.PointerEvent<HTMLButtonElement>,
    item: GrindingPlanningBoardItem,
    currentResource: string | null
  ) => void;
  tableLabel: string;
};

type PlanningBoardItemTableRowProps = {
  item: GrindingPlanningBoardItem;
  allocation: PlanningBoardAllocation;
  selected: boolean;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  onSpecialDueClick?: (item: GrindingPlanningBoardItem) => void;
  specialDueMode: GrindingPlanningBoardSpecialDueKind | null;
  nowMs: number;
  showRank: boolean;
  showSeiban: boolean;
  seibanRank?: number;
  disabled: boolean;
  rankDisabled: boolean;
  resourceDragDisabled: boolean;
  onResourcePointerDown?: (
    event: React.PointerEvent<HTMLButtonElement>,
    item: GrindingPlanningBoardItem,
    currentResource: string | null
  ) => void;
};

const PlanningBoardItemTableRow = memo(function PlanningBoardItemTableRow({
  item,
  allocation,
  selected,
  onToggleItem,
  onResourceClick,
  onRankChange,
  onSpecialDueClick,
  showRank,
  showSeiban,
  seibanRank,
  disabled,
  rankDisabled,
  resourceDragDisabled,
  onResourcePointerDown,
  specialDueMode,
  nowMs
}: PlanningBoardItemTableRowProps) {
  const currentResource = resolveGrindingPlanningBoardResource(item, allocation);
  const currentDue = resolveGrindingPlanningBoardDueDate(item, allocation);
  const rank = allocation === 'alternate' ? item.alternateRank : item.originalRank;
  const plannedQuantity = item.plannedQuantity == null ? '—' : `${item.plannedQuantity}個`;
  const requiredTime = item.requiredMinutesKnown && item.requiredMinutes != null
    ? `${item.requiredMinutes}分`
    : '時間未定';
  const machineName = normalizeMachineName(item.machineName);
  const specialDue = item.specialDue;
  const specialDueExpired = specialDue != null && new Date(specialDue.expiresAt).getTime() <= nowMs;
  const specialDueLabel = specialDue?.kind === 'today' ? '今日中' : specialDue?.kind === 'overnight' ? '朝まで' : null;
  const resourceDragAllowed = Boolean(onResourcePointerDown) && !resourceDragDisabled && !disabled && allocation !== 'original' && !item.isCompleted;
  const rankPickerPanelId = useId();
  const rankPickerAnchorRef = useRef<HTMLButtonElement | null>(null);
  const rankPickerPanelRef = useRef<HTMLDivElement | null>(null);
  const [rankPickerOpen, setRankPickerOpen] = useState(false);
  const rankChoices = rank != null && !rankOptions.some((option) => option === rank)
    ? [rank, ...rankOptions]
    : rankOptions;

  return (
    <tr
      key={item.itemId}
      data-testid={`planning-board-item-${item.itemId}`}
      data-planning-board-item-id={item.itemId}
      className={clsx('border-b border-slate-800/80', specialDueMode && !item.isCompleted && 'cursor-pointer', item.isCompleted && 'opacity-55')}
      onClick={specialDueMode && !item.isCompleted ? () => onSpecialDueClick?.(item) : undefined}
    >
      <td className="px-1 align-middle">
        <label className="grid min-h-11 w-full place-items-center" onClick={(event) => event.stopPropagation()}>
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
          <div className="min-w-0 text-white" title={specialDue ? `${specialDueLabel}（${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(specialDue.expiresAt))}まで）` : undefined}>
            <div className="min-w-0 leading-tight">
              <span className="break-words font-mono text-[10px] font-semibold [overflow-wrap:anywhere]">{item.fhincd || item.productNo}</span>
              <span className="ml-1 break-words font-semibold [overflow-wrap:anywhere]">{item.fhinmei || '部品名未登録'}</span>
              <span className="ml-1 whitespace-nowrap text-[10px] text-white">{plannedQuantity} · {requiredTime}</span>
            </div>
            <div className="mt-0.5 break-words font-mono text-[10px] text-white [overflow-wrap:anywhere]">
              {item.fseiban} · {machineName || '機種名未登録'}
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
        <div className={clsx('min-w-0', showSeiban ? 'flex flex-col items-start gap-0.5' : 'flex items-center gap-0.5')}>
          <div className="flex min-w-0 items-center gap-0.5">
            {seibanRank != null ? (
              <span className={clsx('shrink-0 font-mono leading-none text-white', showSeiban ? 'text-[15px]' : 'text-[10px]')}>
                {seibanRank}
              </span>
            ) : null}
            <button
              type="button"
              className={clsx(
                'inline-flex max-w-full items-center justify-center rounded-md border px-1 font-mono font-bold',
                showSeiban ? 'h-6 min-h-6 min-w-9 text-[15px]' : 'min-h-11 min-w-11',
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
                (allocation === 'original' || item.isCompleted) && 'cursor-not-allowed opacity-60 hover:border-slate-700',
                resourceDragAllowed && 'touch-none cursor-grab active:cursor-grabbing'
              )}
              aria-label={`資源CD ${currentResource ?? '未設定'}を変更`}
              disabled={disabled || allocation === 'original' || item.isCompleted}
              onPointerDown={resourceDragAllowed ? (event) => onResourcePointerDown?.(event, item, currentResource) : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onResourceClick(item);
              }}
            >
              {currentResource ?? '—'}
            </button>
          </div>
          {showSeiban ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] leading-none">
              <span className="whitespace-nowrap text-slate-300">{formatDate(currentDue)}</span>
              {specialDueLabel ? (
                <span className={clsx('whitespace-nowrap rounded px-1 py-0.5 font-semibold', specialDueExpired ? 'bg-rose-950 text-rose-300 ring-1 ring-rose-400/60' : 'bg-amber-400/25 text-amber-200')}>
                  {specialDueLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-1 py-1 align-middle">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
          {!showSeiban ? (
            <span className="whitespace-nowrap text-[10px] text-slate-300">{formatDate(currentDue)}</span>
          ) : null}
          {!showRank && !showSeiban ? (
            <>
              <span className="whitespace-nowrap text-[10px] text-slate-200">{plannedQuantity}</span>
              <span className="whitespace-nowrap text-[10px] text-slate-400">
                {requiredTime}
              </span>
            </>
          ) : null}
          {showRank ? (
            showSeiban ? (
              <>
                <button
                  ref={rankPickerAnchorRef}
                  type="button"
                  disabled={rankDisabled || allocation === 'original' || item.isCompleted || !onRankChange}
                  aria-label={`${item.fhinmei ?? item.fhincd}の個別指定`}
                  aria-haspopup="dialog"
                  aria-expanded={rankPickerOpen}
                  aria-controls={rankPickerOpen ? rankPickerPanelId : undefined}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/25 bg-slate-900/90 px-0 tabular-nums text-[11px] text-white disabled:cursor-not-allowed disabled:opacity-55"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!rankDisabled && allocation !== 'original' && !item.isCompleted && onRankChange) {
                      setRankPickerOpen((open) => !open);
                    }
                  }}
                >
                  {rank ?? '-'}
                </button>
                <LeaderBoardRankPickerDropdown
                  isOpen={rankPickerOpen && !rankDisabled && allocation !== 'original' && !item.isCompleted && Boolean(onRankChange)}
                  anchorRef={rankPickerAnchorRef}
                  panelRef={rankPickerPanelRef}
                  panelId={rankPickerPanelId}
                  choices={rankChoices.map((option) => ({ value: option, label: option == null ? '-' : String(option) }))}
                  selectedValue={rank}
                  onSelectValue={(value) => {
                    onRankChange?.(item, value);
                    setRankPickerOpen(false);
                  }}
                  onRequestClose={() => setRankPickerOpen(false)}
                />
              </>
            ) : (
              <select
                value={rank == null ? '' : String(rank)}
                disabled={rankDisabled || allocation === 'original' || item.isCompleted || !onRankChange}
                aria-label={`${item.fhinmei ?? item.fhincd}の個別指定`}
                className="min-h-11 w-11 rounded-md border border-slate-700 bg-slate-950 px-0.5 text-center text-[10px] text-slate-200 disabled:cursor-not-allowed disabled:opacity-55"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onRankChange?.(item, event.target.value ? Number(event.target.value) : null)}
              >
                {(rank != null && !rankOptions.some((option) => option === rank) ? [rank, ...rankOptions] : rankOptions).map((option) => (
                  <option key={option ?? 'none'} value={option ?? ''}>
                    {option == null ? '－' : option}
                  </option>
                ))}
              </select>
            )
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
    previous.onSpecialDueClick === next.onSpecialDueClick &&
    previous.specialDueMode === next.specialDueMode &&
    previous.nowMs === next.nowMs &&
    previous.showRank === next.showRank &&
    previous.showSeiban === next.showSeiban &&
    previous.showColumnHeaders === next.showColumnHeaders &&
    previous.seibanRankByFseiban === next.seibanRankByFseiban &&
    previous.disabled === next.disabled &&
    previous.rankDisabled === next.rankDisabled &&
    previous.resourceDragDisabled === next.resourceDragDisabled &&
    previous.onResourcePointerDown === next.onResourcePointerDown &&
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
  onSpecialDueClick,
  specialDueMode = null,
  nowMs,
  showRank = false,
  showSeiban = false,
  showColumnHeaders = true,
  seibanRankByFseiban,
  disabled = false,
  rankDisabled = false,
  resourceDragDisabled = false,
  onResourcePointerDown,
  tableLabel
}: PlanningBoardItemTableProps) {
  const defaultNowMsRef = useRef(Date.now());
  const resolvedNowMs = nowMs ?? defaultNowMsRef.current;
  return (
    <div className="min-w-0 overflow-hidden">
      <table className="w-full table-fixed border-collapse text-left text-[11px] text-slate-300">
        <caption className="sr-only">{tableLabel}</caption>
        <colgroup>
          <col className="w-7" />
          <col />
          <col className={seibanRankByFseiban ? 'w-[4rem]' : 'w-[3.25rem]'} />
          <col className={showRank ? (showSeiban ? 'w-[3.5rem]' : 'w-[6.5rem]') : 'w-12 xl:w-[6.5rem]'} />
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
            const itemRankDisabled = typeof rankDisabled === 'function' ? rankDisabled(item) : rankDisabled;
            return (
              <PlanningBoardItemTableRow
                key={item.itemId}
                item={item}
                allocation={allocation}
                selected={selected}
                onToggleItem={onToggleItem}
                onResourceClick={onResourceClick}
                onRankChange={onRankChange}
                onSpecialDueClick={onSpecialDueClick}
                specialDueMode={specialDueMode}
                nowMs={resolvedNowMs}
                showRank={showRank}
                showSeiban={showSeiban}
                seibanRank={seibanRankByFseiban?.get(item.fseiban)}
                disabled={disabled}
                rankDisabled={itemRankDisabled}
                resourceDragDisabled={resourceDragDisabled}
                onResourcePointerDown={onResourcePointerDown}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}, areTablePropsEqual);
