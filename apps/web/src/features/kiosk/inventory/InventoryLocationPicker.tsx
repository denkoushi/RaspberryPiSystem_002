import { useMemo, useState } from 'react';

import { inventoryThumbnailUrl, type InventoryCompartment, type InventoryItem } from '../../../api/client';

import { groupCompartmentsByLocation, unitLabel } from './inventoryDailyFlow';
import { ArrowLeftIcon, PinIcon } from './InventoryIcons';
import { invButtonGhost, invLabel, invPanel, invSeg } from './inventoryUi';

type Props = {
  items: InventoryItem[];
  loading: boolean;
  onPick: (compartment: InventoryCompartment) => void;
  onClose: () => void;
};

export function InventoryLocationPicker({ items, loading, onPick, onClose }: Props) {
  const areas = useMemo(() => groupCompartmentsByLocation(items), [items]);
  const [areaName, setAreaName] = useState<string | null>(null);
  const [shelfNumber, setShelfNumber] = useState<number | null>(null);
  const area = areas.find((entry) => entry.area === areaName) ?? areas[0] ?? null;
  const shelf = area?.shelves.find((entry) => entry.shelfNumber === shelfNumber) ?? area?.shelves[0] ?? null;

  return (
    <section className={`${invPanel} flex min-h-0 flex-1 flex-col gap-4 p-5`} aria-label="置き場所から選ぶ">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={invButtonGhost} onClick={onClose}><ArrowLeftIcon />戻る</button>
        <h2 className="text-[22px] font-black">置き場所から選ぶ</h2>
      </div>
      {loading ? <p className="text-inv-muted">読み込み中…</p> : null}
      {!loading && areas.length === 0 ? <p className="text-inv-muted">登録済みの引き出しはありません。</p> : null}
      {area ? (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="エリア">
            <span className={`${invLabel} w-16`}>エリア</span>
            {areas.map((entry) => (
              <button key={entry.area} type="button" aria-pressed={entry.area === area.area} className={invSeg(entry.area === area.area)} onClick={() => { setAreaName(entry.area); setShelfNumber(null); }}>
                <PinIcon />{entry.area}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="棚">
            <span className={`${invLabel} w-16`}>棚</span>
            {area.shelves.map((entry) => (
              <button key={entry.shelfNumber} type="button" aria-pressed={entry.shelfNumber === shelf?.shelfNumber} className={invSeg(entry.shelfNumber === shelf?.shelfNumber)} onClick={() => setShelfNumber(entry.shelfNumber)}>
                棚{entry.shelfNumber}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {shelf ? (
        <div className="grid grid-cols-[repeat(auto-fill,360px)] gap-3 overflow-y-auto">
          {shelf.compartments.map((compartment) => {
            const photo = compartment.item.photos[0];
            return (
              <button key={compartment.id} type="button" className="flex items-center gap-3 rounded-[14px] border border-inv-line bg-inv-s2 p-3 text-left hover:border-inv-cyan" onClick={() => onPick(compartment)}>
                {photo
                  ? <img src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                  : <span className="h-20 w-20 shrink-0 rounded-lg bg-inv-s3" aria-hidden="true" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs tabular-nums text-inv-faint">引出し{compartment.drawerNumber}</span>
                  <span className="truncate text-lg font-bold">{compartment.item.name}</span>
                </span>
                <span className="text-3xl font-black tabular-nums">{compartment.stockQuantity}</span>
                <span className="self-end pb-1 text-xs text-inv-faint">{unitLabel(compartment.item)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
