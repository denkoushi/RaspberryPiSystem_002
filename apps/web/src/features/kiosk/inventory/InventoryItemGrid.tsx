import { inventoryThumbnailUrl, type InventoryCompartment } from '../../../api/client';

import { issuedLabel, unitLabel } from './inventoryDailyFlow';
import { PinIcon } from './InventoryIcons';

/** Most recently issued first; never-issued drawers follow in name order. */
export function sortByRecentIssue(compartments: InventoryCompartment[]): InventoryCompartment[] {
  return [...compartments].sort((a, b) => {
    const at = a.lastIssuedAt ? Date.parse(a.lastIssuedAt) : null;
    const bt = b.lastIssuedAt ? Date.parse(b.lastIssuedAt) : null;
    if (at !== null && bt !== null && at !== bt) return bt - at;
    if (at !== null && bt === null) return -1;
    if (at === null && bt !== null) return 1;
    return a.item.name.localeCompare(b.item.name, 'ja') || a.shelfNumber - b.shelfNumber || a.drawerNumber - b.drawerNumber;
  });
}

/** Every registered drawer as one photo card; tapping opens it like scanning its item tag. */
export function InventoryItemGrid({ compartments, onPick }: { compartments: InventoryCompartment[]; onPick: (compartment: InventoryCompartment) => void }) {
  const sorted = sortByRecentIssue(compartments);
  if (sorted.length === 0) return <p className="text-inv-muted">登録済みのアイテムはまだありません</p>;
  const now = new Date();
  return (
    <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5 overflow-y-auto pb-1" aria-label="登録済みアイテム">
      {sorted.map((compartment) => {
        const photo = compartment.item.photos[0];
        const issued = issuedLabel(compartment.lastIssuedAt, now);
        const empty = compartment.stockQuantity === 0;
        return (
          <button key={compartment.id} type="button" className="flex flex-col overflow-hidden rounded-[14px] border border-inv-line bg-inv-s1 text-left text-inv-text hover:border-inv-cyan focus:outline-none focus-visible:border-inv-cyan" onClick={() => onPick(compartment)}>
            <span className="relative block h-[150px] w-full bg-inv-s3">
              {photo ? <img src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-full w-full object-cover" /> : null}
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
}
