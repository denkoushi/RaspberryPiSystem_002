import { inventoryThumbnailUrl, type InventoryCompartment } from '../../../api/client';

import { unitLabel } from './inventoryDailyFlow';

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
  if (sorted.length === 0) return <p className="text-white/60">登録済みのアイテムはまだありません</p>;
  return (
    <div className="grid max-h-[calc(100dvh-11rem)] auto-rows-max grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 overflow-y-auto" aria-label="登録済みアイテム">
      {sorted.map((compartment) => {
        const photo = compartment.item.photos[0];
        return (
          <button key={compartment.id} type="button" className="flex flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900/80 text-left text-white hover:border-sky-400" onClick={() => onPick(compartment)}>
            {photo
              ? <img src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-40 w-full object-cover" />
              : <span className="h-40 w-full bg-slate-800" aria-hidden="true" />}
            <span className="flex items-baseline gap-1.5 px-2 pt-1">
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{compartment.item.name}</span>
              <span className="text-lg font-bold">{compartment.stockQuantity}</span>
              <span className="text-xs text-white/60">{unitLabel(compartment.item)}</span>
            </span>
            <span className="truncate px-2 pb-1.5 text-xs text-white/60">{compartment.area}・棚{compartment.shelfNumber}・引出し{compartment.drawerNumber}</span>
          </button>
        );
      })}
    </div>
  );
}
