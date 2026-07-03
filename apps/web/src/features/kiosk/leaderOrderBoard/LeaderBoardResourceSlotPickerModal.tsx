import clsx from 'clsx';

import { kioskButtonSecondaryClassName, kioskPanelClassName, kioskSelectClassName } from '../kioskTheme';
import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../manualOrder/manualOrderOverviewTypography';

import {
  LEADER_BOARD_MAX_RESOURCE_SLOTS,
  LEADER_BOARD_MIN_RESOURCE_SLOTS
} from './constants';
import { formatResourceCdWithJapaneseNames } from './formatResourceCdWithJapaneseNames';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** 候補（API の resources 等） */
  candidateResourceCds: string[];
  resourceNameMap: Record<string, string[]>;
  slotCount: number;
  onSlotCountChange: (next: number) => void;
  resourceCdBySlotIndex: Array<string | null>;
  assignSlotCd: (slotIndex: number, cd: string | null) => void;
};

/**
 * 順位ボード用の薄い資源 CD スロット設定（手動順番モーダルのサブセット）。
 */
export function LeaderBoardResourceSlotPickerModal({
  isOpen,
  onClose,
  candidateResourceCds,
  resourceNameMap,
  slotCount,
  onSlotCountChange,
  resourceCdBySlotIndex,
  assignSlotCd
}: Props) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leader-board-slot-modal-title"
    >
      <div
        className={clsx(
          kioskPanelClassName,
          'flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col bg-slate-900',
          KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS
        )}
      >
        <div className="border-b border-white/10 px-4 py-3">
          <h2 id="leader-board-slot-modal-title" className="text-sm font-semibold text-sky-200">
            順位ボードの資源スロット
          </h2>
          <p className="mt-1 text-xs text-white/60">
            各スロットに資源 CD を割り当てます。一覧の取得単位はスロット設定に従います（端末の手動順番割当とは別）。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2">
          <label className="flex items-center gap-2 text-xs text-white/75">
            スロット数
            <select
              value={slotCount}
              onChange={(e) => onSlotCountChange(Number(e.target.value))}
              className={clsx(kioskSelectClassName, 'px-2 text-xs')}
            >
              {Array.from(
                { length: LEADER_BOARD_MAX_RESOURCE_SLOTS - LEADER_BOARD_MIN_RESOURCE_SLOTS + 1 },
                (_, i) => LEADER_BOARD_MIN_RESOURCE_SLOTS + i
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ul className="space-y-2">
            {resourceCdBySlotIndex.map((current, slotIndex) => (
              <li
                key={slotIndex}
                className="rounded border border-white/10 bg-slate-950/50 px-3 py-2"
              >
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">
                  スロット {slotIndex + 1}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={current ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      assignSlotCd(slotIndex, v.length > 0 ? v : null);
                    }}
                    className={clsx(kioskSelectClassName, 'min-w-[12rem] flex-1 font-mono text-xs')}
                    aria-label={`スロット ${slotIndex + 1} の資源 CD`}
                  >
                    <option value="">（未設定）</option>
                    {candidateResourceCds.map((cd) => (
                      <option key={cd} value={cd}>
                        {formatResourceCdWithJapaneseNames(cd, resourceNameMap)}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className={clsx(kioskButtonSecondaryClassName, 'text-xs')}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
