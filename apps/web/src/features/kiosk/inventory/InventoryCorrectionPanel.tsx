import { useState } from 'react';

import { inventoryThumbnailUrl } from '../../../api/client';
import { KioskDigitTenkey } from '../KioskDigitTenkey';

import { correctionSummary, unitLabel } from './inventoryDailyFlow';
import { ArrowRightIcon } from './InventoryIcons';
import { invButtonGhost, invButtonPrimary, invError, invEyebrow, invKey, invKeyUtil, invPanel } from './inventoryUi';

import type { InventoryCompartment } from '../../../api/client';

type Props = {
  compartment: InventoryCompartment;
  pending: boolean;
  error: string | null;
  onConfirm: (desiredQuantity: number) => void;
  onCancel: () => void;
};

export function InventoryCorrectionPanel({ compartment, pending, error, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState('');
  const current = compartment.stockQuantity;
  const unit = unitLabel(compartment.item);
  const counted = value === '' ? null : Number(value);
  const ready = counted !== null && Number.isSafeInteger(counted) && counted !== current && !pending;
  const photo = compartment.item.photos[0];

  return (
    <section className={`${invPanel} grid w-[1180px] max-w-full grid-cols-[minmax(0,1fr)_360px] gap-10 p-9 shadow-[0_30px_80px_rgba(0,0,0,0.6)]`} aria-label="在庫の数を直す">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          {photo
            ? <img src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-[72px] w-[72px] shrink-0 rounded-xl object-cover" />
            : <span className="h-[72px] w-[72px] shrink-0 rounded-xl bg-inv-s3" aria-hidden="true" />}
          <div className="min-w-0">
            <h2 className="truncate text-[22px] font-black">{compartment.item.name}</h2>
            <p className="text-[13px] text-inv-faint">{compartment.area} ・ 棚{compartment.shelfNumber} ・ 引出し{compartment.drawerNumber}</p>
          </div>
        </div>
        <div className="flex items-center justify-center gap-7 rounded-2xl bg-inv-s2 p-7">
          <div className="text-center">
            <p className={invEyebrow}>いまの記録</p>
            <p className="text-[88px] font-black leading-none tabular-nums text-inv-faint">{current}</p>
          </div>
          <span className="text-inv-faint"><ArrowRightIcon /></span>
          <div className="text-center">
            <p className={`${invEyebrow} !text-inv-cyan`}>数えた数</p>
            <output className="block text-[88px] font-black leading-none tabular-nums text-inv-cyan" aria-label="数えた数">{value === '' ? '—' : counted}</output>
          </div>
        </div>
        <p className="flex min-h-11 justify-center" aria-live="polite">
          {counted !== null ? (
            <span className={`inline-flex h-11 items-center rounded-full border-[1.5px] px-5 text-[17px] font-black ${counted === current ? 'border-inv-line2 text-inv-muted' : 'border-inv-amber bg-inv-amber/[0.12] text-[#ffe8bf]'}`}>{correctionSummary(current, counted, unit)}</span>
          ) : null}
        </p>
        {error ? <p className={`rounded-xl border p-3 text-base ${invError}`} role="alert">{error}</p> : null}
      </div>
      <div className="flex flex-col gap-2.5">
        <KioskDigitTenkey
          value={value}
          onChange={(next) => setValue(next.replace(/^0+(?=\d)/, ''))}
          maxLength={6}
          ariaLabel="数えた数のテンキー"
          className="grid grid-cols-3 gap-2.5 [&>button:nth-child(10)]:col-start-2"
          keyClassName={invKey}
          resetClassName={invKeyUtil}
          disabled={pending}
        />
        <button type="button" className={`${invButtonPrimary} mt-1.5 h-[60px] text-[19px]`} disabled={!ready} onClick={() => counted !== null && onConfirm(counted)}>
          {pending ? '記録中…' : counted === null ? '数を入れてください' : `${counted}${unit}に直す`}
        </button>
        <button type="button" className={invButtonGhost} disabled={pending} onClick={onCancel}>やめる</button>
      </div>
    </section>
  );
}
