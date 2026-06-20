import clsx from 'clsx';
import { memo, useCallback, useMemo } from 'react';

import { resolveLeaderBoardGanttCapacityMinutes } from './gantt/leaderBoardGanttCapacity';
import { LeaderOrderResourceCard } from './LeaderOrderResourceCard';

import type { LeaderBoardRow } from './types';
import type { KioskProductionScheduleCompletionIntent } from '../../../api/client';
import type { KioskResourceProgressProcessChip } from '../../../components/kiosk/resourceProgress/KioskResourceProcessChips';

export type LeaderBoardGridProps = {
  resourceCdBySlotIndex: Array<string | null>;
  sortedGrouped: Map<string, LeaderBoardRow[]>;
  resourceNameMap: Record<string, string[]>;
  orderUsageByResourceCd: Record<string, number[]> | undefined;
  /** 製番 OR フィルタ。1件以上のときリスト順と左縁色を対応付け。**空でも製番単位でハッシュ着色**される */
  activeSeibanFilters?: readonly string[];
  selectedResourceCd: string | null;
  setSelectedResourceCd: (cd: string) => void;
  onOpenDueDatePicker: (row: LeaderBoardRow) => void;
  dueDatePending: boolean;
  onOrderChange: (row: LeaderBoardRow, nextValue: string) => void;
  onCompleteRow: (rowId: string, intent: KioskProductionScheduleCompletionIntent) => void;
  completePending: boolean;
  orderPending: boolean;
  onOpenNote: (row: LeaderBoardRow) => void;
  notePending: boolean;
  onOpenInspectionWorkflow?: (row: LeaderBoardRow) => void;
  onOpenSplitModal?: (row: LeaderBoardRow) => void;
  splitFeatureEnabled?: boolean;
  /** 背景同期中など、行操作を明示的に無効化 */
  interactionLocked?: boolean;
  footerResourceChipsByPartKey: ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]>;
  seibanEvalEnabled?: boolean;
  ganttEnabled?: boolean;
  /** 基準時間帯解決用（スロット文脈） */
  siteKey?: string;
  deviceScopeKey?: string;
  listIncomplete?: boolean;
  autoRankDisabled?: boolean;
  autoRankPending?: boolean;
  onAutoRank?: (resourceCd: string) => void;
  /** スロットごとの `+人` ON/OFF（slotIndex 順） */
  laborEnabledBySlotIndex?: readonly boolean[];
  onToggleLaborForSlot?: (slotIndex: number) => void;
};

type SlotCardProps = {
  resourceCd: string;
  capacityMinutes: number;
  rows: LeaderBoardRow[];
  activeSeibanFilters: readonly string[] | undefined;
  selectedResourceCd: string | null;
  setSelectedResourceCd: (cd: string) => void;
  resourceJapaneseNames: string;
  orderUsageNumbers: readonly number[] | undefined;
  onOpenDueDatePicker: (row: LeaderBoardRow) => void;
  dueDatePending: boolean;
  onOrderChange: (row: LeaderBoardRow, nextValue: string) => void;
  onCompleteRow: (rowId: string, intent: KioskProductionScheduleCompletionIntent) => void;
  completePending: boolean;
  orderPending: boolean;
  onOpenNote: (row: LeaderBoardRow) => void;
  notePending: boolean;
  onOpenInspectionWorkflow?: (row: LeaderBoardRow) => void;
  onOpenSplitModal?: (row: LeaderBoardRow) => void;
  splitFeatureEnabled?: boolean;
  footerResourceChipsByPartKey: ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]>;
  seibanEvalEnabled?: boolean;
  ganttEnabled?: boolean;
  listIncomplete?: boolean;
  autoRankDisabled?: boolean;
  autoRankPending?: boolean;
  onAutoRank?: (resourceCd: string) => void;
  laborEnabled?: boolean;
  onToggleLabor?: () => void;
};

const LeaderBoardSlotCard = memo(function LeaderBoardSlotCard({
  resourceCd,
  capacityMinutes,
  rows,
  activeSeibanFilters,
  selectedResourceCd,
  setSelectedResourceCd,
  resourceJapaneseNames,
  orderUsageNumbers,
  onOpenDueDatePicker,
  dueDatePending,
  onOrderChange,
  onCompleteRow,
  completePending,
  orderPending,
  onOpenNote,
  notePending,
  onOpenInspectionWorkflow,
  onOpenSplitModal,
  splitFeatureEnabled = false,
  footerResourceChipsByPartKey,
  seibanEvalEnabled = false,
  ganttEnabled = false,
  autoRankDisabled = false,
  autoRankPending = false,
  onAutoRank,
  laborEnabled = false,
  onToggleLabor
}: SlotCardProps) {
  const onSelect = useCallback(() => {
    setSelectedResourceCd(resourceCd);
  }, [resourceCd, setSelectedResourceCd]);

  const selected = selectedResourceCd === resourceCd;
  const dimmed = selectedResourceCd != null && !selected;

  return (
    <LeaderOrderResourceCard
      resourceCd={resourceCd}
      capacityMinutes={capacityMinutes}
      resourceJapaneseNames={resourceJapaneseNames}
      rows={rows}
      selected={selected}
      dimmed={dimmed}
      onSelect={onSelect}
      onOpenDueDatePicker={onOpenDueDatePicker}
      dueDatePending={dueDatePending}
      orderUsageNumbers={orderUsageNumbers}
      activeSeibanFilters={activeSeibanFilters}
      onOrderChange={onOrderChange}
      onCompleteRow={onCompleteRow}
      completePending={completePending}
      orderPending={orderPending}
      onOpenNote={onOpenNote}
      notePending={notePending}
      onOpenInspectionWorkflow={onOpenInspectionWorkflow}
      onOpenSplitModal={onOpenSplitModal}
      splitFeatureEnabled={splitFeatureEnabled}
      footerResourceChipsByPartKey={footerResourceChipsByPartKey}
      seibanEvalEnabled={seibanEvalEnabled}
      ganttEnabled={ganttEnabled}
      autoRankDisabled={autoRankDisabled}
      autoRankPending={autoRankPending}
      onAutoRank={onAutoRank}
      laborEnabled={laborEnabled}
      onToggleLabor={onToggleLabor}
    />
  );
});

/**
 * 資源スロットグリッド。スロット単位でコールバックを安定化しカードの memo を活かす。
 */
export const LeaderBoardGrid = memo(function LeaderBoardGrid({
  resourceCdBySlotIndex,
  sortedGrouped,
  resourceNameMap,
  orderUsageByResourceCd,
  activeSeibanFilters,
  selectedResourceCd,
  setSelectedResourceCd,
  onOpenDueDatePicker,
  dueDatePending,
  onOrderChange,
  onCompleteRow,
  completePending,
  orderPending,
  onOpenNote,
  notePending,
  onOpenInspectionWorkflow,
  onOpenSplitModal,
  splitFeatureEnabled = false,
  interactionLocked = false,
  footerResourceChipsByPartKey,
  seibanEvalEnabled = false,
  ganttEnabled = false,
  siteKey = '',
  deviceScopeKey = '',
  listIncomplete = false,
  autoRankDisabled = false,
  autoRankPending = false,
  onAutoRank,
  laborEnabledBySlotIndex = [],
  onToggleLaborForSlot
}: LeaderBoardGridProps) {
  const rowControlsLocked = interactionLocked;

  const capacityMinutesBySlotIndex = useMemo(
    () =>
      resourceCdBySlotIndex.map((cdRaw, slotIndex) => {
        const resourceCd = cdRaw?.trim() ?? '';
        if (resourceCd.length === 0) return 0;
        return resolveLeaderBoardGanttCapacityMinutes({
          siteKey,
          deviceScopeKey,
          slotIndex,
          resourceCd
        });
      }),
    [resourceCdBySlotIndex, siteKey, deviceScopeKey]
  );

  return (
    <div
      className={clsx(
        'grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-auto md:grid-cols-4 xl:grid-cols-6',
        '[grid-auto-rows:minmax(14rem,1fr)]'
      )}
    >
      {resourceCdBySlotIndex.map((cdRaw, slotIndex) => {
        const cd = cdRaw?.trim() ?? '';
        if (cd.length === 0) {
          return (
            <div
              key={`slot-empty-${slotIndex}`}
              className="flex h-full min-h-[14rem] flex-col rounded-lg border border-dashed border-white/20 bg-slate-900/35 p-2.5"
            >
              <div className="text-[11px] font-medium text-white/50">スロット {slotIndex + 1}</div>
              <p className="mt-2 text-xs text-white/40">未設定（操作パネル→資源スロット）</p>
            </div>
          );
        }
        const rows = sortedGrouped.get(cd) ?? [];
        const jpNames = (resourceNameMap[cd] ?? []).join(' / ');
        const orderUsageNumbers = orderUsageByResourceCd?.[cd];
        const capacityMinutes = capacityMinutesBySlotIndex[slotIndex] ?? 0;
        return (
          <LeaderBoardSlotCard
            key={`slot-${slotIndex}-${cd}`}
            resourceCd={cd}
            capacityMinutes={capacityMinutes}
            rows={rows}
            activeSeibanFilters={activeSeibanFilters}
            selectedResourceCd={selectedResourceCd}
            setSelectedResourceCd={setSelectedResourceCd}
            resourceJapaneseNames={jpNames}
            orderUsageNumbers={orderUsageNumbers}
            onOpenDueDatePicker={onOpenDueDatePicker}
            dueDatePending={dueDatePending || rowControlsLocked}
            onOrderChange={onOrderChange}
            onCompleteRow={onCompleteRow}
            completePending={completePending || rowControlsLocked}
            orderPending={orderPending || rowControlsLocked}
            onOpenNote={onOpenNote}
            notePending={notePending || rowControlsLocked}
            onOpenInspectionWorkflow={onOpenInspectionWorkflow}
            onOpenSplitModal={onOpenSplitModal}
            splitFeatureEnabled={splitFeatureEnabled}
            footerResourceChipsByPartKey={footerResourceChipsByPartKey}
            seibanEvalEnabled={seibanEvalEnabled}
            ganttEnabled={ganttEnabled}
            autoRankDisabled={autoRankDisabled || rowControlsLocked || listIncomplete}
            autoRankPending={autoRankPending}
            onAutoRank={onAutoRank}
            laborEnabled={Boolean(laborEnabledBySlotIndex[slotIndex])}
            onToggleLabor={
              onToggleLaborForSlot ? () => onToggleLaborForSlot(slotIndex) : undefined
            }
          />
        );
      })}
    </div>
  );
});
