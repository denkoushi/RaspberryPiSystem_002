import { useMemo } from 'react';

import { LeaderBoardRankPickerDropdown } from './LeaderBoardRankPickerDropdown';

import type { MutableRefObject } from 'react';

export type LeaderBoardSeibanRankPickerProps = {
  isOpen: boolean;
  anchorRef: MutableRefObject<HTMLElement | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  panelId: string;
  totalCount: number;
  /** 1始まり。開いている対象の現在順位 */
  currentRank: number;
  onSelectRank: (rank1Based: number) => void;
  onRequestClose: () => void;
};

/**
 * 順位ボード左ペイン: 登録製番の表示順を 1…N から選択（Portal・左ドロワーより前面）。
 */
export function LeaderBoardSeibanRankPicker({
  isOpen,
  anchorRef,
  panelRef,
  panelId,
  totalCount,
  currentRank,
  onSelectRank,
  onRequestClose
}: LeaderBoardSeibanRankPickerProps) {
  const choices = useMemo(
    () =>
      totalCount > 0
        ? Array.from({ length: totalCount }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
        : [],
    [totalCount]
  );

  return (
    <LeaderBoardRankPickerDropdown
      isOpen={isOpen}
      anchorRef={anchorRef}
      panelRef={panelRef}
      panelId={panelId}
      choices={choices}
      selectedValue={currentRank}
      onSelectValue={(value) => {
        if (value != null) onSelectRank(value);
      }}
      onRequestClose={onRequestClose}
    />
  );
}
