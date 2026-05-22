import { memo, useCallback } from 'react';

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
  /** 背景同期中など、行操作を明示的に無効化 */
  interactionLocked?: boolean;
  footerResourceChipsByPartKey: ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]>;
  seibanEvalEnabled?: boolean;
  listIncomplete?: boolean;
  autoRankDisabled?: boolean;
  autoRankPending?: boolean;
  onAutoRank?: (resourceCd: string) => void;
};

type SlotCardProps = {
  resourceCd: string;
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
  footerResourceChipsByPartKey: ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]>;
  seibanEvalEnabled?: boolean;
  listIncomplete?: boolean;
  autoRankDisabled?: boolean;
  autoRankPending?: boolean;
  onAutoRank?: (resourceCd: string) => void;
};

const LeaderBoardSlotCard = memo(function LeaderBoardSlotCard({
  resourceCd,
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
  footerResourceChipsByPartKey,
  seibanEvalEnabled = false,
  autoRankDisabled = false,
  autoRankPending = false,
  onAutoRank
}: SlotCardProps) {
  const onSelect = useCallback(() => {
    setSelectedResourceCd(resourceCd);
  }, [resourceCd, setSelectedResourceCd]);

  const selected = selectedResourceCd === resourceCd;
  const dimmed = selectedResourceCd != null && !selected;

  return (
    <LeaderOrderResourceCard
      resourceCd={resourceCd}
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
      footerResourceChipsByPartKey={footerResourceChipsByPartKey}
      seibanEvalEnabled={seibanEvalEnabled}
      autoRankDisabled={autoRankDisabled}
      autoRankPending={autoRankPending}
      onAutoRank={onAutoRank}
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
  interactionLocked = false,
  footerResourceChipsByPartKey,
  seibanEvalEnabled = false,
  listIncomplete = false,
  autoRankDisabled = false,
  autoRankPending = false,
  onAutoRank
}: LeaderBoardGridProps) {
  const rowControlsLocked = interactionLocked;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-auto [grid-auto-rows:minmax(14rem,1fr)] md:grid-cols-4 xl:grid-cols-6">
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
        return (
          <LeaderBoardSlotCard
            key={`slot-${slotIndex}-${cd}`}
            resourceCd={cd}
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
            footerResourceChipsByPartKey={footerResourceChipsByPartKey}
            seibanEvalEnabled={seibanEvalEnabled}
            autoRankDisabled={autoRankDisabled || rowControlsLocked || listIncomplete}
            autoRankPending={autoRankPending}
            onAutoRank={onAutoRank}
          />
        );
      })}
    </div>
  );
});
