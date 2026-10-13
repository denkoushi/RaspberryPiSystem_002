import { formatInventoryLabelNumber } from '@raspi-system/shared-types';
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { inventoryThumbnailUrl, type InventoryCompartment, type InventoryImportSummary } from '../../../api/client';

import { issuedLabel, unitLabel } from './inventoryDailyFlow';
import { LockIcon, PinIcon } from './InventoryIcons';
import { invLabelNumber } from './inventoryUi';

export type InventoryThumbnailSize = 'small' | 'medium' | 'large';
export type InventoryViewMode = 'card' | 'list';
const listColumns = 'grid grid-cols-[56px_80px_minmax(0,1.5fr)_minmax(0,1.5fr)_130px_minmax(0,1fr)_120px_110px_minmax(0,1fr)_190px_84px_84px] items-center gap-3.5 pl-1 pr-3';
const listRow = `${listColumns} min-h-16 shrink-0 rounded-[10px] border bg-inv-s1 py-1 text-left text-inv-text focus:outline-none`;
const sizes = {
  small: { columns: 'grid-cols-9', photo: 'h-[110px]', fields: ['model'] },
  medium: { columns: 'grid-cols-6', photo: 'h-[190px]', fields: ['model', 'maker', 'toolSize'] },
  large: { columns: 'grid-cols-4', photo: 'h-[300px]', fields: ['model', 'maker', 'toolName', 'toolSize', 'workMaterial', 'usage'] },
} as const;
const detailLabels = { model: '型式', maker: 'メーカー', toolName: '工具名', toolSize: '寸法', workMaterial: '被削材', usage: '用途' };

function InventoryCardTooltip({ id, compartment, rect }: { id: string; compartment: InventoryCompartment; rect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: rect.right + 8, top: rect.top });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const left = rect.right + 8 + width <= window.innerWidth - 8 ? rect.right + 8 : rect.left - width - 8;
    const top = rect.top + height <= window.innerHeight - 8 ? rect.top : rect.bottom - height;
    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
    });
  }, [rect]);
  const rows = [
    ['番号', formatInventoryLabelNumber(compartment.labelNumber)],
    ['名前', compartment.item.name.trim()],
    ...Object.entries(detailLabels).map(([field, label]) => [label, compartment.item[field as keyof typeof detailLabels]?.trim()]),
    ['場所', `${compartment.area}・棚${compartment.shelfNumber}-${compartment.drawerNumber}`],
    ['在庫', `${compartment.stockQuantity} ${unitLabel(compartment.item)}`],
    ['持出', issuedLabel(compartment.lastIssuedAt, new Date())],
  ];
  return createPortal(<div ref={ref} id={id} role="tooltip" style={position} className="pointer-events-none fixed z-50 max-h-[calc(100dvh-16px)] w-[344px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-inv-line2 bg-inv-s1 p-4 text-sm text-inv-text shadow-xl">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
      {rows.map(([label, value]) => value ? <Fragment key={label}><dt className="text-inv-faint">{label}</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</dd></Fragment> : null)}
    </dl>
  </div>, document.body);
}

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
  const [tooltip, setTooltip] = useState<{ compartment: InventoryCompartment; rect: DOMRect } | null>(null);
  const tooltipId = useId();
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTooltip = useCallback(() => { clearTimeout(tooltipTimer.current); setTooltip(null); }, []);
  useEffect(() => {
    hideTooltip();
    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('pointerdown', hideTooltip, true);
    window.addEventListener('click', hideTooltip, true);
    return () => {
      clearTimeout(tooltipTimer.current);
      window.removeEventListener('scroll', hideTooltip, true);
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('pointerdown', hideTooltip, true);
      window.removeEventListener('click', hideTooltip, true);
    };
  }, [hideTooltip, size, view, compartments]);
  const showTooltip = (compartment: InventoryCompartment, element: HTMLElement) => {
    hideTooltip();
    if (view !== 'card' || size === 'large') return;
    const rect = element.getBoundingClientRect();
    tooltipTimer.current = setTimeout(() => setTooltip({ compartment, rect }), 150);
  };
  const config = sizes[size];
  const sorted = useMemo(() => sortByRecentIssue(compartments), [compartments]);
  if (sorted.length === 0 && pending.length === 0) return <p className="text-inv-muted">登録済みのアイテムはまだありません</p>;
  const now = new Date();
  if (view === 'list') return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-1" aria-label="登録済みアイテム">
      <div className={`${listColumns} shrink-0 text-xs tracking-[0.06em] text-inv-faint`}>
        <span /><span>番号</span><span>名前</span><span>型式</span><span>メーカー</span><span>工具名</span><span>寸法</span><span>被削材</span><span>用途</span><span>場所</span><span className="text-right">在庫</span><span className="text-right">持出</span>
      </div>
      {pending.map((candidate) => (
        <button key={candidate.id} type="button" aria-label={`未登録 候補 #${candidate.sourceItemId} を登録する`} className={`${listRow} border-2 border-inv-amber hover:brightness-110 focus-visible:brightness-110`} onClick={() => onPickPending?.(candidate)}>
          <span className="block h-14 w-14 overflow-hidden rounded-lg bg-inv-s3">
            {candidate.photoUrl ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(candidate.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-inv-amber px-2 py-1 text-xs font-black text-inv-amber-ink"><LockIcon size={14} />未登録</span>
          <span className="truncate text-[17px] font-bold">候補 #{candidate.sourceItemId}</span>
          <span className="col-span-6 truncate text-sm text-inv-muted">{candidate.category}</span>
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
            <span aria-label="置き場所の番号" className={`${invLabelNumber} min-w-0 truncate justify-self-start text-sm`}>{formatInventoryLabelNumber(compartment.labelNumber)}</span>
            <span className="truncate text-[17px] font-bold">{compartment.item.name.trim() || '—'}</span>
            <span className="truncate text-base font-bold text-inv-text">{compartment.item.model?.trim() || '—'}</span>
            {(['maker', 'toolName', 'toolSize', 'workMaterial', 'usage'] as const).map(field => <span key={field} className="truncate text-[15px] text-inv-muted">{compartment.item[field]?.trim() || '—'}</span>)}
            <span className="truncate text-sm text-inv-muted">{compartment.area}・棚{compartment.shelfNumber}-{compartment.drawerNumber}</span>
            <span className={`truncate text-right text-[19px] font-black tabular-nums ${compartment.stockQuantity === 0 ? 'text-inv-amber' : 'text-inv-text'}`}>{compartment.stockQuantity} {unitLabel(compartment.item)}</span>
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
        const empty = compartment.stockQuantity === 0;
        return (
          <div key={compartment.id} className="relative min-w-0"
            onPointerEnter={event => { if (window.matchMedia?.('(hover: hover)').matches ?? true) showTooltip(compartment, event.currentTarget); }}
            onPointerLeave={hideTooltip}
            onFocus={event => { if (event.target.matches(':focus-visible')) showTooltip(compartment, event.currentTarget); }}
            onBlur={hideTooltip}
          >
          <button type="button" aria-describedby={tooltip?.compartment.id === compartment.id ? tooltipId : undefined} className="flex h-full w-full flex-col overflow-hidden rounded-[14px] border border-inv-line bg-inv-s1 text-left text-inv-text hover:border-inv-cyan focus:outline-none focus-visible:border-inv-cyan" onClick={() => onPick(compartment)}>
            <span className={`relative block ${config.photo} w-full shrink-0 bg-inv-s3`}>
              {photo ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
              <span className="absolute inset-x-1.5 top-1.5 flex items-start gap-1.5">
                <span className="flex shrink-0 items-baseline gap-1 rounded-lg bg-inv-bg/75 px-2 py-1 text-sm font-bold">
                  <span className={`text-[22px] font-black tabular-nums ${empty ? 'text-inv-amber' : 'text-inv-text'}`}>{compartment.stockQuantity}</span>
                  <span>{unitLabel(compartment.item)}</span>
                </span>
                {size !== 'small' && compartment.item.model?.trim() ? <span className={`ml-auto min-w-0 line-clamp-2 rounded-lg bg-inv-bg/75 px-2 py-1 text-right font-bold leading-snug [overflow-wrap:anywhere] ${size === 'large' ? 'text-[15px]' : 'text-[13px]'}`}>{compartment.item.model}</span> : null}
              </span>
            </span>
            <span className="flex w-full min-w-0 flex-col gap-1 px-3 pb-2 pt-2">
              <span className={`line-clamp-2 ${size === 'medium' ? '' : 'min-h-[2.6em]'} break-words text-base font-bold leading-[1.3]`}>{compartment.item.name}</span>
              {size === 'small' ? <>
                <span aria-label="置き場所の番号" className={`${invLabelNumber} self-start text-[13px]`}>{formatInventoryLabelNumber(compartment.labelNumber)}</span>
                {compartment.item.model?.trim() ? <span className="truncate text-[13px] text-inv-muted">{compartment.item.model}</span> : null}
              </> : size === 'medium' ? (
                <span className="flex min-w-0 flex-col">
                  {[
                    [compartment.item.maker, compartment.item.toolName, compartment.item.toolSize],
                    [compartment.item.workMaterial, compartment.item.usage],
                  ].map((values, index) => {
                    const text = values.map(value => value?.trim()).filter(Boolean).join(' ・ ');
                    return text ? <span key={index} className={`truncate text-[13px] ${index === 0 ? 'text-inv-text' : 'text-inv-muted'}`}>{text}</span> : null;
                  })}
                </span>
              ) : <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-2 text-[13px]">
                {config.fields.filter(field => field !== 'model').map((field) => compartment.item[field]?.trim() ? <Fragment key={field}><dt className="text-inv-faint">{detailLabels[field]}</dt><dd className="truncate">{compartment.item[field]}</dd></Fragment> : null)}
              </dl>}
            </span>
          </button>
          <div className={`pointer-events-none absolute inset-x-0 top-0 ${config.photo}`}>
            <div className="absolute inset-x-1.5 bottom-1.5 flex items-end gap-1.5" aria-label="写真下部">
              {photos.length > 1 ? <div className="flex shrink-0 gap-1" role="group" aria-label="写真の切り替え">
                {([-1, 1] as const).map((offset) => <button key={offset} type="button" aria-label={offset === -1 ? '前の写真' : '次の写真'} className="pointer-events-auto flex h-[42px] w-10 items-center justify-center rounded-lg border border-inv-line2 bg-inv-bg/75 text-lg font-bold text-inv-text" onClick={(event) => {
                  event.stopPropagation();
                  setPhotoIndices((current) => ({ ...current, [compartment.id]: (photoIndex + offset + photos.length) % photos.length }));
                }}>{offset === -1 ? '＜' : '＞'}</button>)}
              </div> : null}
              {size !== 'small' ? <span className={`flex min-w-0 gap-1 rounded-lg bg-inv-bg/75 px-2 py-1 ${size === 'large' ? 'flex-row items-center' : 'flex-col items-start'}`}>
                <span aria-label="置き場所の番号" className={`${invLabelNumber} text-[13px]`}>{formatInventoryLabelNumber(compartment.labelNumber)}</span>
                <span className="max-w-full truncate text-xs text-inv-text">{compartment.area}・棚{compartment.shelfNumber}-{compartment.drawerNumber}</span>
              </span> : null}
              {photos.length > 1 ? <span aria-label="写真の枚数" className="ml-auto shrink-0 rounded-md bg-inv-bg/75 px-2 text-sm font-bold tabular-nums text-inv-text">{photoIndex + 1}/{photos.length}</span> : null}
            </div>
          </div>
          </div>
        );
      })}
      {tooltip && size !== 'large' ? <InventoryCardTooltip id={tooltipId} {...tooltip} /> : null}
    </div>
  );
});
