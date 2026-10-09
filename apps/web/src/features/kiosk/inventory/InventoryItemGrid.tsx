import { formatInventoryLabelNumber } from '@raspi-system/shared-types';
import { Fragment, memo, useMemo, useState } from 'react';

import { inventoryThumbnailUrl, type InventoryCompartment, type InventoryImportSummary } from '../../../api/client';

import { issuedLabel, unitLabel } from './inventoryDailyFlow';
import { LockIcon, PinIcon } from './InventoryIcons';
import { invLabelNumber } from './inventoryUi';

export type InventoryThumbnailSize = 'small' | 'medium' | 'large';
export type InventoryViewMode = 'card' | 'list';
const listColumns = 'grid grid-cols-[56px_80px_minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_84px_96px] items-center gap-3 pl-1 pr-3';
const listRow = `${listColumns} min-h-16 shrink-0 rounded-[10px] border bg-inv-s1 py-1 text-left text-inv-text focus:outline-none`;
const sizes = {
  small: { columns: 'grid-cols-9', photo: 'h-[110px]', fields: ['model'] },
  medium: { columns: 'grid-cols-6', photo: 'h-[190px]', fields: ['model', 'maker', 'toolSize'] },
  large: { columns: 'grid-cols-4', photo: 'h-[300px]', fields: ['model', 'maker', 'toolName', 'toolSize', 'workMaterial', 'usage'] },
} as const;
const detailLabels = { model: '型式', maker: 'メーカー', toolName: '工具名', toolSize: '寸法', workMaterial: '被削材', usage: '用途' };

const collator = new Intl.Collator('ja');

/** Most recently issued first; never-issued drawers follow in name order. */
export function sortByRecentIssue(compartments: InventoryCompartment[]): InventoryCompartment[] {
  return [...compartments].sort((a, b) => {
    const at = a.lastIssuedAt ? Date.parse(a.lastIssuedAt) : null;
    const bt = b.lastIssuedAt ? Date.parse(b.lastIssuedAt) : null;
    if (at !== null && bt !== null && at !== bt) return bt - at;
    if (at !== null && bt === null) return -1;
    if (at === null && bt !== null) return 1;
    return collator.compare(a.item.name, b.item.name) || a.shelfNumber - b.shelfNumber || a.drawerNumber - b.drawerNumber;
  });
}

type InventoryItemGridProps = {
  size?: InventoryThumbnailSize;
  view?: InventoryViewMode;
  compartments: InventoryCompartment[];
  onPick: (compartment: InventoryCompartment) => void;
  /** Mailed candidates not registered yet, newest first; they lead the list. */
  pending?: InventoryImportSummary[];
  onPickPending?: (candidate: InventoryImportSummary) => void;
};

/** Every registered drawer as one card or row; tapping opens it like scanning its item tag. */
export const InventoryItemGrid = memo(function InventoryItemGrid({ compartments, onPick, pending = [], onPickPending, size = 'medium', view = 'card' }: InventoryItemGridProps) {
  const [photoIndices, setPhotoIndices] = useState<Record<string, number>>({});
  const config = sizes[size];
  const sorted = useMemo(() => sortByRecentIssue(compartments), [compartments]);
  if (sorted.length === 0 && pending.length === 0) return <p className="text-inv-muted">登録済みのアイテムはまだありません</p>;
  const now = new Date();
  if (view === 'list') return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-1" aria-label="登録済みアイテム">
      <div className={`${listColumns} shrink-0 text-xs tracking-[0.06em] text-inv-faint`}>
        <span /><span>番号</span><span>名前</span><span>型式・メーカー</span><span>場所</span><span className="text-right">在庫</span><span className="text-right">持出</span>
      </div>
      {pending.map((candidate) => (
        <button key={candidate.id} type="button" aria-label={`未登録 候補 #${candidate.sourceItemId} を登録する`} className={`${listRow} border-2 border-inv-amber hover:brightness-110 focus-visible:brightness-110`} onClick={() => onPickPending?.(candidate)}>
          <span className="block h-14 w-14 overflow-hidden rounded-lg bg-inv-s3">
            {candidate.photoUrl ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(candidate.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-inv-amber px-2 py-1 text-xs font-black text-inv-amber-ink"><LockIcon size={14} />未登録</span>
          <span className="truncate text-[17px] font-bold">候補 #{candidate.sourceItemId}</span>
          <span className="truncate text-sm text-inv-muted">{candidate.category}</span>
          <span className="truncate text-sm text-inv-muted">{candidate.area}</span>
          <span className="text-right text-inv-muted">—</span><span className="text-right text-sm text-inv-muted">—</span>
        </button>
      ))}
      {sorted.map((compartment) => {
        const photo = compartment.item.photos[0];
        return (
          <button key={compartment.id} type="button" className={`${listRow} border-inv-line hover:border-inv-cyan focus-visible:border-inv-cyan`} onClick={() => onPick(compartment)}>
            <span className="block h-14 w-14 overflow-hidden rounded-lg bg-inv-s3">
              {photo ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
            </span>
            <span aria-label="置き場所の番号" className={`${invLabelNumber} justify-self-start text-sm`}>{formatInventoryLabelNumber(compartment.labelNumber)}</span>
            <span className="truncate text-[17px] font-bold">{compartment.item.name}</span>
            <span className="truncate text-sm text-inv-muted">{[compartment.item.model, compartment.item.maker].map((value) => value?.trim()).filter(Boolean).join(' ・ ')}</span>
            <span className="truncate text-sm text-inv-muted">{compartment.area}・棚{compartment.shelfNumber}・引き出し{compartment.drawerNumber}</span>
            <span className={`text-right text-[19px] font-black tabular-nums ${compartment.stockQuantity === 0 ? 'text-inv-amber' : 'text-inv-text'}`}>{compartment.stockQuantity} {unitLabel(compartment.item)}</span>
            <span className="truncate text-right text-sm text-inv-muted">{issuedLabel(compartment.lastIssuedAt, now) ?? '—'}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className={`grid min-h-0 flex-1 auto-rows-max ${config.columns} gap-3 overflow-y-auto pb-1`} aria-label="登録済みアイテム">
      {pending.map((candidate) => (
        <button key={candidate.id} type="button" aria-label={`未登録 候補 #${candidate.sourceItemId} を登録する`} className="flex flex-col overflow-hidden rounded-[14px] border-2 border-inv-amber bg-inv-s1 text-left text-inv-text hover:brightness-110 focus:outline-none focus-visible:brightness-110" onClick={() => onPickPending?.(candidate)}>
          <span className={`relative block ${config.photo} w-full bg-inv-s3`}>
            {candidate.photoUrl ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(candidate.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
            <span className="absolute left-2 top-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-inv-amber px-3 text-[13px] font-black text-inv-amber-ink"><LockIcon size={14} />未登録</span>
          </span>
          <span className="px-3 pt-2.5 text-sm font-bold">候補 #{candidate.sourceItemId}</span>
          <span className="flex items-center gap-1 px-3 pb-3 pt-0.5 text-xs text-inv-faint">
            <PinIcon />
            <span className="min-w-0 truncate">{candidate.area}</span>
            {candidate.category ? <span className="ml-auto shrink-0 font-bold text-inv-muted">{candidate.category}</span> : null}
          </span>
        </button>
      ))}
      {sorted.map((compartment) => {
        const photos = compartment.item.photos;
        const photoIndex = (photoIndices[compartment.id] ?? 0) % (photos.length || 1);
        const photo = photos[photoIndex];
        const issued = issuedLabel(compartment.lastIssuedAt, now);
        const empty = compartment.stockQuantity === 0;
        return (
          <div key={compartment.id} className="relative min-w-0">
          <button type="button" className="flex h-full w-full flex-col overflow-hidden rounded-[14px] border border-inv-line bg-inv-s1 text-left text-inv-text hover:border-inv-cyan focus:outline-none focus-visible:border-inv-cyan" onClick={() => onPick(compartment)}>
            <span className={`relative block ${config.photo} w-full shrink-0 bg-inv-s3`}>
              {photo ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
              {issued ? <span className="absolute left-2 top-2 rounded-md bg-inv-bg/75 px-2 py-0.5 text-[11px] font-bold tracking-[0.06em]">{issued} 持出</span> : null}
            </span>
            <span className="line-clamp-2 min-h-[3.05em] px-3 pt-2.5 text-[17px] font-bold leading-[1.35]">{compartment.item.name}</span>
            <span className="flex px-3 pt-1" aria-label="置き場所の番号"><span className={`${invLabelNumber} text-sm`}>{formatInventoryLabelNumber(compartment.labelNumber)}</span></span>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 px-3 pt-1 text-sm">
              {config.fields.map((field) => compartment.item[field]?.trim() ? <Fragment key={field}><dt className="text-inv-faint">{detailLabels[field]}</dt><dd className="truncate">{compartment.item[field]}</dd></Fragment> : null)}
            </dl>
            <span className="mt-auto flex min-w-0 flex-wrap items-baseline gap-1.5 px-3 pb-3 pt-1 text-base text-inv-muted">
              <span className={`shrink-0 text-[26px] font-black tabular-nums ${empty ? 'text-inv-amber' : 'text-inv-text'}`}>{compartment.stockQuantity}</span>
              <span className="min-w-0 break-all">{unitLabel(compartment.item)}</span>
              <span className="ml-auto min-w-0 break-all text-sm">{compartment.area}・棚{compartment.shelfNumber}-{compartment.drawerNumber}</span>
            </span>
          </button>
          {photos.length > 1 ? <div className={`pointer-events-none absolute inset-x-0 top-0 ${config.photo}`}>
            {([-1, 1] as const).map((offset) => <button key={offset} type="button" aria-label={offset === -1 ? '前の写真' : '次の写真'} className={`pointer-events-auto absolute top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-inv-line2 bg-inv-bg/75 text-xl text-inv-text ${offset === -1 ? 'left-2' : 'right-2'}`} onClick={(event) => {
              event.stopPropagation();
              setPhotoIndices((current) => ({ ...current, [compartment.id]: (photoIndex + offset + photos.length) % photos.length }));
            }}>{offset === -1 ? '＜' : '＞'}</button>)}
            <span className="absolute bottom-2 right-2 rounded-md bg-inv-bg/75 px-2 text-sm font-bold tabular-nums text-inv-text">{photoIndex + 1}/{photos.length}</span>
          </div> : null}
          </div>
        );
      })}
    </div>
  );
});
