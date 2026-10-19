import { invCard, invEyebrow } from './inventoryUi';

import type { InventoryCompartment } from '../../../api/client';

/** Shows area, shelf and drawer as separate labelled values instead of one "/"-joined string. */
export function InventoryLocationBlocks({ compartment }: { compartment: Pick<InventoryCompartment, 'area' | 'shelfNumber' | 'drawerNumber'> }) {
  return (
    <dl className={`${invCard} grid grid-cols-[minmax(0,1fr)_auto_auto] overflow-hidden`} aria-label="保管場所">
      <div className="border-r border-inv-line px-4 py-3">
        <dt className={invEyebrow}>エリア</dt>
        <dd className="mt-1 break-all text-lg font-black">{compartment.area}</dd>
      </div>
      <div className="border-r border-inv-line px-5 py-3 text-center">
        <dt className={invEyebrow}>棚</dt>
        <dd className="text-[34px] font-black leading-tight tabular-nums">{compartment.shelfNumber}</dd>
      </div>
      <div className="px-5 py-3 text-center">
        <dt className={invEyebrow}>引出し</dt>
        <dd className="text-[34px] font-black leading-tight tabular-nums">{compartment.drawerNumber}</dd>
      </div>
    </dl>
  );
}
