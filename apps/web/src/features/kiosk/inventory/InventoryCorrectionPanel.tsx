import { useState } from 'react';

import { KioskDigitTenkey } from '../KioskDigitTenkey';
import { kioskButtonPrimaryClassName, kioskButtonSecondaryClassName, kioskPanelClassName } from '../kioskTheme';

import { compartmentLocationText, correctionSummary } from './inventoryDailyFlow';

import type { InventoryCompartment } from '../../../api/client';

type Props = {
  compartment: InventoryCompartment;
  pending: boolean;
  error: string | null;
  onConfirm: (desiredQuantity: number) => void;
  onCancel: () => void;
};

const keyClassName =
  'inline-flex h-16 items-center justify-center rounded-lg border border-white/15 bg-slate-950 text-3xl font-bold text-white hover:bg-slate-800 disabled:opacity-40';
const resetClassName =
  'inline-flex h-16 items-center justify-center rounded-lg border border-amber-300/30 bg-slate-950 text-lg font-bold text-amber-200 hover:bg-slate-800 disabled:opacity-40';

export function InventoryCorrectionPanel({ compartment, pending, error, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState('');
  const current = compartment.stockQuantity;
  const counted = value === '' ? null : Number(value);
  const ready = counted !== null && Number.isSafeInteger(counted) && counted !== current && !pending;

  return (
    <section className={`${kioskPanelClassName} grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_22rem]`} aria-label="在庫の数を直す">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">在庫の数を直す</h2>
          <p className="text-base text-white/70">{compartment.item.name} ・ {compartmentLocationText(compartment)}</p>
        </div>
        <div className="flex items-center justify-around rounded-lg bg-slate-950/60 p-5 text-center">
          <div>
            <p className="text-base text-white/60">いまの記録</p>
            <p className="text-6xl font-bold text-white/70">{current}</p>
          </div>
          <span className="text-4xl text-white/40" aria-hidden="true">→</span>
          <div>
            <p className="text-base text-white/60">数えた数</p>
            <output className="block text-6xl font-bold text-sky-300" aria-label="数えた数">{value === '' ? '—' : counted}</output>
          </div>
        </div>
        <p className="text-center text-xl font-semibold text-white" aria-live="polite">
          {counted === null ? '数えた数をテンキーで入れてください' : correctionSummary(current, counted)}
        </p>
        {error ? <p className="rounded border border-red-400/50 bg-red-950/60 p-3 text-base text-red-100" role="alert">{error}</p> : null}
        <p className="text-sm text-white/60">直した内容は履歴に残ります。間違えたら「直前の取引を取消」で戻せます。</p>
      </div>
      <div className="flex flex-col gap-3">
        <KioskDigitTenkey
          value={value}
          onChange={(next) => setValue(next.replace(/^0+(?=\d)/, ''))}
          maxLength={6}
          ariaLabel="数えた数のテンキー"
          className="grid grid-cols-3 gap-2"
          keyClassName={keyClassName}
          resetClassName={resetClassName}
          disabled={pending}
        />
        <button type="button" className={`${kioskButtonPrimaryClassName} min-h-16 text-xl`} disabled={!ready} onClick={() => counted !== null && onConfirm(counted)}>
          {pending ? '記録中…' : counted === null ? '数を入れてください' : `${counted}個に直す`}
        </button>
        <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12 text-lg`} disabled={pending} onClick={onCancel}>やめる</button>
      </div>
    </section>
  );
}
