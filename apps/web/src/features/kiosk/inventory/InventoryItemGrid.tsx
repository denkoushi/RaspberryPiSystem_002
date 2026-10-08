import { memo, useMemo } from 'react';

import { inventoryThumbnailUrl, type InventoryCompartment, type InventoryImportSummary } from '../../../api/client';

import { issuedLabel, unitLabel } from './inventoryDailyFlow';
import { LockIcon, PinIcon } from './InventoryIcons';

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
  compartments: InventoryCompartment[];
  onPick: (compartment: InventoryCompartment) => void;
  /** Mailed candidates not registered yet, newest first; they lead the list. */
  pending?: InventoryImportSummary[];
  onPickPending?: (candidate: InventoryImportSummary) => void;
};

/** Every registered drawer as one photo card; tapping opens it like scanning its item tag. */
export const InventoryItemGrid = memo(function InventoryItemGrid({ compartments, onPick, pending = [], onPickPending }: InventoryItemGridProps) {
  const sorted = useMemo(() => sortByRecentIssue(compartments), [compartments]);
  if (sorted.length === 0 && pending.length === 0) return <p className="text-inv-muted">登録済みのアイテムはまだありません</p>;
  const now = new Date();
  return (
    <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5 overflow-y-auto pb-1" aria-label="登録済みアイテム">
      {pending.map((candidate) => (
        <button key={candidate.id} type="button" aria-label={`未登録 候補 #${candidate.sourceItemId} を登録する`} className="flex flex-col overflow-hidden rounded-[14px] border-2 border-inv-amber bg-inv-s1 text-left text-inv-text hover:brightness-110 focus:outline-none focus-visible:brightness-110" onClick={() => onPickPending?.(candidate)}>
          <span className="relative block h-[150px] w-full bg-inv-s3">
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
        const photo = compartment.item.photos[0];
        const issued = issuedLabel(compartment.lastIssuedAt, now);
        const empty = compartment.stockQuantity === 0;
        return (
          <button key={compartment.id} type="button" className="flex flex-col overflow-hidden rounded-[14px] border border-inv-line bg-inv-s1 text-left text-inv-text hover:border-inv-cyan focus:outline-none focus-visible:border-inv-cyan" onClick={() => onPick(compartment)}>
            <span className="relative block h-[150px] w-full bg-inv-s3">
              {photo ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
              {issued ? <span className="absolute left-2 top-2 rounded-md bg-inv-bg/75 px-2 py-0.5 text-[11px] font-bold tracking-[0.06em]">{issued} 持出</span> : null}
            </span>
            <span className="flex items-baseline gap-1.5 px-3 pt-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{compartment.item.name}</span>
              <span className={`text-[22px] font-black tabular-nums ${empty ? 'text-inv-amber' : ''}`}>{compartment.stockQuantity}</span>
              <span className="text-xs text-inv-faint">{unitLabel(compartment.item)}</span>
            </span>
            <span className="flex items-center gap-1 px-3 pb-3 pt-0.5 text-xs text-inv-faint">
              <PinIcon />
              <span className="min-w-0 truncate">{compartment.area}</span>
              <span className="ml-auto shrink-0 font-bold tabular-nums text-inv-muted">棚{compartment.shelfNumber} 引{compartment.drawerNumber}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
});
