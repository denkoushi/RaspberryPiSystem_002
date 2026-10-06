import clsx from 'clsx';

import type { MaterialArrivalBasis, MaterialArrivalStatus } from '@raspi-system/shared-types';

const PRESENTATION: Record<MaterialArrivalStatus, { label: string; className: string }> = {
  received: { label: '材料入荷済', className: 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' },
  partial: { label: '材料一部入荷済', className: 'border-amber-400/65 bg-amber-500/20 text-amber-200' },
  ordered: { label: '材料未入荷', className: 'border-rose-400/70 bg-rose-500/20 text-rose-200' },
  unordered: { label: '材料未発注', className: 'border-dashed border-slate-400/60 text-slate-300' }
};

type Props = {
  status: MaterialArrivalStatus | null | undefined;
  basis?: MaterialArrivalBasis | null;
  className?: string;
};

/** 材料（鋳物・鋼材など）の入荷状況バッジ。材料の購買行が無い部品では何も描かない。 */
export function MaterialArrivalBadge({ status, basis, className }: Props) {
  if (!status) return null;
  if (!Object.prototype.hasOwnProperty.call(PRESENTATION, status)) return null;
  const presentation = PRESENTATION[status];
  return (
    <span
      className={clsx(
        'inline-block shrink-0 whitespace-nowrap rounded border px-1 py-0.5 text-[10px] leading-none',
        presentation.className,
        className
      )}
    >
      {basis === 'part' ? presentation.label.replace('材料', '部品') : presentation.label}
    </span>
  );
}
