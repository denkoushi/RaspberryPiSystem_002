import { inventoryThumbnailUrl, type InventoryCompartment } from '../../../api/client';

import { unitLabel } from './inventoryDailyFlow';

/** Every registered drawer as one photo card; tapping opens it like scanning its item tag. */
export function InventoryItemGrid({ compartments, onPick }: { compartments: InventoryCompartment[]; onPick: (compartment: InventoryCompartment) => void }) {
  const sorted = [...compartments].sort((a, b) => a.item.name.localeCompare(b.item.name, 'ja') || a.shelfNumber - b.shelfNumber || a.drawerNumber - b.drawerNumber);
  if (sorted.length === 0) return <p className="text-white/60">登録済みのアイテムはまだありません</p>;
  return (
    <div className="grid max-h-[calc(100dvh-15rem)] auto-rows-max grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 overflow-y-auto" aria-label="登録済みアイテム">
      {sorted.map((compartment) => {
        const photo = compartment.item.photos[0];
        return (
          <button key={compartment.id} type="button" className="flex flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900/80 text-left text-white hover:border-sky-400" onClick={() => onPick(compartment)}>
            {photo
              ? <img src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-[150px] w-full object-cover" />
              : <span className="h-[150px] w-full bg-slate-800" aria-hidden="true" />}
            <span className="flex items-baseline gap-1.5 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{compartment.item.name}</span>
              <span className="text-lg font-bold">{compartment.stockQuantity}</span>
              <span className="text-xs text-white/60">{unitLabel(compartment.item)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
