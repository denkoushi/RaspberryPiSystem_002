import { useState } from 'react';

import { KioskDigitTenkey } from '../KioskDigitTenkey';

import { invButtonGhost, invButtonPrimary, invKey, invKeyUtil, invPanel } from './inventoryUi';

type Props = {
  unit: string;
  restock: boolean;
  pending: boolean;
  error: string | null;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
};

export function InventoryQuantityPanel({ unit, restock, pending, error, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState('');
  const quantity = Number(value);
  const ready = Number.isSafeInteger(quantity) && quantity > 0 && !pending;
  return (
    <section className={`${invPanel} flex w-[400px] flex-col gap-3 p-6`} aria-label="ほかの数を入れる">
      <h2 className="text-xl font-black">{restock ? '補充する数' : '払い出す数'}</h2>
      <output aria-label="操作する数" className="text-center text-5xl font-black tabular-nums">{value || '—'}<span className="ml-2 text-xl text-inv-muted">{unit}</span></output>
      <KioskDigitTenkey value={value} onChange={(next) => setValue(next.replace(/^0+(?=\d)/, ''))} maxLength={6} ariaLabel="操作する数のテンキー" className="grid grid-cols-3 gap-2.5 [&>button:nth-child(10)]:col-start-2" keyClassName={invKey} resetClassName={invKeyUtil} disabled={pending} />
      <div className="h-11" aria-live="polite">{error ? <p role="alert" className="text-inv-red">{error}</p> : null}</div>
      <button type="button" className={invButtonPrimary} disabled={!ready} onClick={() => onConfirm(quantity)}>{pending ? '記録中…' : '決定'}</button>
      <button type="button" className={invButtonGhost} disabled={pending} onClick={onCancel}>やめる</button>
    </section>
  );
}
