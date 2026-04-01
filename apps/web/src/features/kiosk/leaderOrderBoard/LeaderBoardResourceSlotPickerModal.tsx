import clsx from 'clsx';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../manualOrder/manualOrderOverviewTypography';

import {
  LEADER_BOARD_MAX_RESOURCE_SLOTS,
  LEADER_BOARD_MIN_RESOURCE_SLOTS
} from './constants';

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

function formatResourceLine(cd: string, resourceNameMap: Record<string, string[]>): string {
  const names = resourceNameMap[cd] ?? [];
  return names.length > 0 ? `${cd}（${names.join(' / ')}）` : cd;
}

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
          'flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col rounded-lg border border-white/15 bg-slate-900 shadow-xl',
          KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS
        )}
      >
        <div className="border-b border-white/10 px-4 py-3">
          <h2 id="leader-board-slot-modal-title" className="text-sm font-semibold text-cyan-200">
            順位ボードの資源スロット
          </h2>
          <p className="mt-1 text-xs text-white/55">
            各スロットに資源 CD を割り当てます。一覧の取得単位はスロット設定に従います（端末の手動順番割当とは別）。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2">
          <label className="flex items-center gap-2 text-xs text-white/75">
            スロット数
            <select
              value={slotCount}
              onChange={(e) => onSlotCountChange(Number(e.target.value))}
              className="rounded border border-white/20 bg-slate-950 px-2 py-1 text-white"
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
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">
                  スロット {slotIndex + 1}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={current ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      assignSlotCd(slotIndex, v.length > 0 ? v : null);
                    }}
                    className="min-w-[12rem] flex-1 rounded border border-white/20 bg-slate-900 px-2 py-1.5 font-mono text-xs text-white"
                    aria-label={`スロット ${slotIndex + 1} の資源 CD`}
                  >
                    <option value="">（未設定）</option>
                    {candidateResourceCds.map((cd) => (
                      <option key={cd} value={cd}>
                        {formatResourceLine(cd, resourceNameMap)}
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
            className="rounded border border-white/25 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
