import type { InventoryCompartment } from '../../../api/client';

/** Shows area, shelf and drawer as separate labelled values instead of one "/"-joined string. */
export function InventoryLocationBlocks({ compartment }: { compartment: Pick<InventoryCompartment, 'area' | 'shelfNumber' | 'drawerNumber'> }) {
  return (
    <dl className="grid grid-cols-[auto_auto] gap-2" aria-label="保管場所">
      <div className="col-span-2 rounded-lg bg-slate-950/50 px-3 py-2">
        <dt className="text-sm text-white/60">エリア</dt>
        <dd className="break-all text-xl font-bold text-white">{compartment.area}</dd>
      </div>
      <div className="rounded-lg bg-slate-950/50 px-3 py-2">
        <dt className="text-sm text-white/60">棚</dt>
        <dd className="text-4xl font-bold text-white">{compartment.shelfNumber}</dd>
      </div>
      <div className="rounded-lg bg-slate-950/50 px-3 py-2">
        <dt className="text-sm text-white/60">引出し</dt>
        <dd className="text-4xl font-bold text-white">{compartment.drawerNumber}</dd>
      </div>
    </dl>
  );
}
