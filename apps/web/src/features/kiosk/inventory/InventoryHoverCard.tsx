import { formatInventoryLabelNumber } from '@raspi-system/shared-types';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { inventoryThumbnailUrl, type InventoryCompartment } from '../../../api/client';

import { issuedLabel, unitLabel } from './inventoryDailyFlow';
import { detailLabels, invLabelNumber } from './inventoryUi';
import './inventoryHoverCard.css';

export function InventoryHoverCard({ id, compartment, rect }: { id: string; compartment: InventoryCompartment; rect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: rect.right + 12, top: rect.top });
  // The 640px thumbnail already fills the 440px frame; no full-size download per hover.
  const photo = compartment.item.photos[0];
  useLayoutEffect(() => {
    if (!ref.current) return;
    // Measure the stationary wrapper, independently of the inner pop-in transform.
    const { width, height } = ref.current.getBoundingClientRect();
    const left = rect.right + 12 + width <= window.innerWidth - 8 ? rect.right + 12 : rect.left - width - 12;
    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)),
    });
  }, [rect]);
  const rows = [
    ...Object.entries(detailLabels).map(([field, label]) => ({ label, value: compartment.item[field as keyof typeof detailLabels]?.trim(), mono: field === 'model' || field === 'toolSize' })),
    { label: '場所', value: `${compartment.area}・棚${compartment.shelfNumber}-${compartment.drawerNumber}`, mono: false },
  ];
  return createPortal(<div ref={ref} id={id} role="tooltip" style={position} className="pointer-events-none fixed z-50 w-[560px] max-w-[calc(100vw-16px)] text-inv-text">
    <div className="inventory-hover-card flex max-h-[calc(100dvh-16px)] flex-col gap-3 overflow-hidden rounded-[20px] border border-inv-cyan/[.55] bg-gradient-to-b from-[#273650] to-[#1f2b3d] p-3.5 shadow-[0_30px_70px_rgba(0,0,0,.7),0_10px_24px_rgba(0,0,0,.5),0_0_0_4px_rgba(57,208,240,.10)] motion-reduce:animate-none">
      <div className="relative flex h-[440px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-inv-line2 bg-inv-bg">
        {photo ? <img src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.originalFilename} className="h-full w-full object-contain" /> : <span className="text-inv-faint">写真なし</span>}
        {compartment.item.photos.length > 1 ? <div aria-label="写真の枚数" className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {compartment.item.photos.map((entry, index) => <span key={entry.id} className={`h-2 w-2 rounded-full ${index === 0 ? 'bg-white' : 'bg-white/[.35]'}`} />)}
        </div> : null}
      </div>
      <div className="flex items-start gap-2.5">
        <span aria-label="置き場所の番号" className={`${invLabelNumber} mt-0.5 shrink-0 text-base`}>{formatInventoryLabelNumber(compartment.labelNumber)}</span>
        <span className="min-w-0 flex-1 break-all text-[22px] font-black leading-tight">{compartment.item.name.trim()}</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-inv-line2 bg-[rgba(9,13,20,.55)] px-3 py-2">
          <span className="block text-xs text-inv-faint">在庫</span>
          <div><strong className="text-[22px] font-black tabular-nums">{compartment.stockQuantity}</strong> {unitLabel(compartment.item)}</div>
        </div>
        <div className="rounded-xl border border-inv-line2 bg-[rgba(9,13,20,.55)] px-3 py-2">
          <span className="block text-xs text-inv-faint">最後の持出</span>
          <strong className="text-lg font-black">{issuedLabel(compartment.lastIssuedAt, new Date()) ?? 'まだ'}</strong>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-[15px]">
        {rows.map(({ label, value, mono }) => value ? <Fragment key={label}><dt className="text-inv-muted">{label}</dt><dd className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}>{value}</dd></Fragment> : null)}
      </dl>
    </div>
  </div>, document.body);
}
