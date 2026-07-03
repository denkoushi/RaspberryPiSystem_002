import clsx from 'clsx';
import { useId, useMemo, useRef, useState } from 'react';

import { availableProcessingOrderOptions } from './availableProcessingOrderOptions';
import { LeaderBoardRankPickerDropdown } from './LeaderBoardRankPickerDropdown';

type Props = {
  resourceCd: string;
  currentOrder: number | null;
  usageNumbers: readonly number[] | undefined;
  disabled: boolean;
  onChange: (nextValue: string) => void;
};

/**
 * 資源内加工順（1–10 / 未割当「-」）。左ペイン登録製番の順位ボタンと同一 UI。
 */
export function LeaderOrderRowOrderSelect({
  resourceCd,
  currentOrder,
  usageNumbers,
  disabled,
  onChange
}: Props) {
  const panelId = useId();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const options = useMemo(
    () => availableProcessingOrderOptions(resourceCd, currentOrder, usageNumbers),
    [resourceCd, currentOrder, usageNumbers]
  );

  const choices = useMemo(
    () => [
      { value: null as number | null, label: '-' },
      ...options.map((num) => ({ value: num, label: String(num) }))
    ],
    [options]
  );

  const displayLabel = currentOrder != null ? String(currentOrder) : '-';
  const hasRankedOrder = currentOrder != null && !disabled;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setIsOpen((open) => !open);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={
          currentOrder != null ? `資源内の順位 ${currentOrder}、タップで変更` : '資源内の順位、タップで設定'
        }
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        className={clsx(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border px-0 tabular-nums',
          disabled
            ? 'cursor-not-allowed border-white/15 bg-slate-900/50 text-[11px] text-white/60'
            : hasRankedOrder
              ? 'border-sky-400 bg-sky-500/25 text-sm font-semibold text-sky-100'
              : 'border-white/25 bg-slate-900/90 text-[11px] text-white'
        )}
      >
        {displayLabel}
      </button>
      <LeaderBoardRankPickerDropdown
        isOpen={isOpen && !disabled}
        anchorRef={anchorRef}
        panelRef={panelRef}
        panelId={panelId}
        choices={choices}
        selectedValue={currentOrder}
        onSelectValue={(value) => onChange(value == null ? '' : String(value))}
        onRequestClose={() => setIsOpen(false)}
      />
    </>
  );
}
