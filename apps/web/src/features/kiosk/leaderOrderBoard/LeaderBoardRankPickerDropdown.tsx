import { useEffect } from 'react';

import { AnchoredDropdownPortal } from '../../../components/kiosk/AnchoredDropdownPortal';
import { KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK } from '../../../hooks/kioskRevealUi';

import type { MutableRefObject } from 'react';

export type LeaderBoardRankPickerChoice = {
  value: number | null;
  label: string;
};

export type LeaderBoardRankPickerDropdownProps = {
  isOpen: boolean;
  anchorRef: MutableRefObject<HTMLElement | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  panelId: string;
  choices: readonly LeaderBoardRankPickerChoice[];
  selectedValue: number | null;
  onSelectValue: (value: number | null) => void;
  onRequestClose: () => void;
  fixedZIndex?: number;
  title?: string;
};

/**
 * 順位ボード共通: アンカー下に 1…N（または加工順 1–10 / 「-」）を縦リストで選ぶ Portal。
 * 左ペイン登録製番・行内加工順で同一 UI。
 */
export function LeaderBoardRankPickerDropdown({
  isOpen,
  anchorRef,
  panelRef,
  panelId,
  choices,
  selectedValue,
  onSelectValue,
  onRequestClose,
  fixedZIndex = KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK,
  title = '順位を選択'
}: LeaderBoardRankPickerDropdownProps) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onRequestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onRequestClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const t = event.target as Node;
      const inAnchor = anchorRef.current?.contains(t) ?? false;
      const inPanel = panelRef.current?.contains(t) ?? false;
      if (!inAnchor && !inPanel) {
        onRequestClose();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, anchorRef, panelRef, onRequestClose]);

  return (
    <AnchoredDropdownPortal
      isOpen={isOpen}
      id={panelId}
      ariaLabel={title}
      anchorRef={anchorRef}
      panelRef={panelRef}
      fixedZIndex={fixedZIndex}
      className="w-[min(12rem,calc(100vw-2rem))] rounded-lg border border-white/20 bg-slate-950/95 p-2"
    >
      <p className="mb-1.5 px-0.5 text-xs font-semibold uppercase tracking-wide text-white/60">{title}</p>
      <div className="max-h-[14rem] overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {choices.map((choice) => {
            const selected =
              choice.value === selectedValue || (choice.value == null && selectedValue == null);
            return (
              <button
                key={choice.value == null ? '__clear__' : choice.value}
                type="button"
                className={
                  selected
                    ? 'rounded-md border border-emerald-400/50 bg-emerald-500/25 px-2.5 py-1.5 text-left text-sm font-bold tabular-nums text-emerald-100'
                    : 'rounded-md px-2.5 py-1.5 text-left text-sm font-semibold tabular-nums text-white/95 hover:bg-white/10'
                }
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  onSelectValue(choice.value);
                  onRequestClose();
                }}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      </div>
    </AnchoredDropdownPortal>
  );
}
