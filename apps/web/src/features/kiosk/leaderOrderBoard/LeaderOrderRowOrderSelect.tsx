import clsx from 'clsx';
import { useMemo } from 'react';

import { availableProcessingOrderOptions } from './availableProcessingOrderOptions';

type Props = {
  resourceCd: string;
  currentOrder: number | null;
  usageNumbers: readonly number[] | undefined;
  disabled: boolean;
  onChange: (nextValue: string) => void;
};

/**
 * 資源内加工順（1–10 / 未割当「-」）。生産スケジュールと同じ利用可否規則。
 */
export function LeaderOrderRowOrderSelect({
  resourceCd,
  currentOrder,
  usageNumbers,
  disabled,
  onChange
}: Props) {
  const options = useMemo(
    () => availableProcessingOrderOptions(resourceCd, currentOrder, usageNumbers),
    [resourceCd, currentOrder, usageNumbers]
  );

  return (
    <select
      value={currentOrder ?? ''}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      aria-label="資源内の順位"
      className={clsx(
        'h-7 w-14 shrink-0 rounded border px-1.5 text-[11px]',
        disabled
          ? 'cursor-not-allowed border-white/15 bg-slate-900/50 text-white/40'
          : 'border-white/25 bg-slate-900/90 text-white'
      )}
    >
      <option value="">-</option>
      {options.map((num) => (
        <option key={num} value={num}>
          {num}
        </option>
      ))}
    </select>
  );
}
