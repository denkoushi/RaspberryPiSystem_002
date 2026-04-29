import { memo, useCallback } from 'react';

import { LeaderOrderResourceCard } from './LeaderOrderResourceCard';

import type { LeaderBoardRow } from './types';

export type LeaderBoardGridProps = {
  resourceCdBySlotIndex: Array<string | null>;
  sortedGrouped: Map<string, LeaderBoardRow[]>;
  resourceNameMap: Record<string, string[]>;
  orderUsageByResourceCd: Record<string, number[]> | undefined;
  selectedResourceCd: string | null;
  setSelectedResourceCd: (cd: string) => void;
  onOpenDueDatePicker: (row: LeaderBoardRow) => void;
  dueDatePending: boolean;
  onOrderChange: (row: LeaderBoardRow, nextValue: string) => void;
  onCompleteRow: (rowId: string) => void;
  completePending: boolean;
  orderPending: boolean;
  onOpenNote: (row: LeaderBoardRow) => void;
  notePending: boolean;
};

type SlotCardProps = {
  resourceCd: string;
  rows: LeaderBoardRow[];
  selectedResourceCd: string | null;
  setSelectedResourceCd: (cd: string) => void;
  resourceJapaneseNames: string;
  orderUsageNumbers: readonly number[] | undefined;
  onOpenDueDatePicker: (row: LeaderBoardRow) => void;
  dueDatePending: boolean;
  onOrderChange: (row: LeaderBoardRow, nextValue: string) => void;
  onCompleteRow: (rowId: string) => void;
  completePending: boolean;
  orderPending: boolean;
  onOpenNote: (row: LeaderBoardRow) => void;
  notePending: boolean;
};

const LeaderBoardSlotCard = memo(function LeaderBoardSlotCard({
  resourceCd,
  rows,
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
  notePending
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
      onOrderChange={onOrderChange}
      onCompleteRow={onCompleteRow}
      completePending={completePending}
      orderPending={orderPending}
      onOpenNote={onOpenNote}
      notePending={notePending}
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
  selectedResourceCd,
  setSelectedResourceCd,
  onOpenDueDatePicker,
  dueDatePending,
  onOrderChange,
  onCompleteRow,
  completePending,
  orderPending,
  onOpenNote,
  notePending
}: LeaderBoardGridProps) {
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
            selectedResourceCd={selectedResourceCd}
            setSelectedResourceCd={setSelectedResourceCd}
            resourceJapaneseNames={jpNames}
            orderUsageNumbers={orderUsageNumbers}
            onOpenDueDatePicker={onOpenDueDatePicker}
            dueDatePending={dueDatePending}
            onOrderChange={onOrderChange}
            onCompleteRow={onCompleteRow}
            completePending={completePending}
            orderPending={orderPending}
            onOpenNote={onOpenNote}
            notePending={notePending}
          />
        );
      })}
    </div>
  );
});
