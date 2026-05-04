import { useEffect } from 'react';

import { AnchoredDropdownPortal } from '../../../components/kiosk/AnchoredDropdownPortal';
import { KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK } from '../../../hooks/kioskRevealUi';

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

  const ranks =
    totalCount > 0 ? Array.from({ length: totalCount }, (_, i) => i + 1) : [];

  return (
    <AnchoredDropdownPortal
      isOpen={isOpen}
      id={panelId}
      ariaLabel="順位を選択"
      anchorRef={anchorRef}
      panelRef={panelRef}
      fixedZIndex={KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK}
      className="w-[min(12rem,calc(100vw-2rem))] rounded-lg border border-white/20 bg-slate-950/95 p-2 shadow-xl"
    >
      <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/55">
        順位を選択
      </p>
      <div className="max-h-[14rem] overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {ranks.map((rank) => (
            <button
              key={rank}
              type="button"
              className={
                rank === currentRank
                  ? 'rounded-md border border-emerald-400/50 bg-emerald-500/25 px-2.5 py-1.5 text-left text-sm font-bold tabular-nums text-emerald-100'
                  : 'rounded-md px-2.5 py-1.5 text-left text-sm font-semibold tabular-nums text-white/95 hover:bg-white/10'
              }
              aria-current={rank === currentRank ? 'true' : undefined}
              onClick={() => {
                onSelectRank(rank);
                onRequestClose();
              }}
            >
              {rank}
            </button>
          ))}
        </div>
      </div>
    </AnchoredDropdownPortal>
  );
}
