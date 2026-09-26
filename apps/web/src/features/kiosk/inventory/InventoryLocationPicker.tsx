import { useMemo, useState } from 'react';

import { inventoryThumbnailUrl, type InventoryCompartment, type InventoryItem } from '../../../api/client';
import { kioskButtonSecondaryClassName, kioskPanelClassName } from '../kioskTheme';

import { groupCompartmentsByLocation } from './inventoryDailyFlow';

type Props = {
  items: InventoryItem[];
  loading: boolean;
  onPick: (compartment: InventoryCompartment) => void;
  onClose: () => void;
};

const choiceClassName = 'min-h-14 rounded-lg border px-5 text-lg font-bold';
const selectedChoiceClassName = `${choiceClassName} border-sky-400 bg-sky-950/60 text-white`;
const idleChoiceClassName = `${choiceClassName} border-white/20 bg-slate-900/60 text-white hover:bg-slate-800`;

export function InventoryLocationPicker({ items, loading, onPick, onClose }: Props) {
  const areas = useMemo(() => groupCompartmentsByLocation(items), [items]);
  const [areaName, setAreaName] = useState<string | null>(null);
  const [shelfNumber, setShelfNumber] = useState<number | null>(null);
  const area = areas.find((entry) => entry.area === areaName) ?? areas[0] ?? null;
  const shelf = area?.shelves.find((entry) => entry.shelfNumber === shelfNumber) ?? area?.shelves[0] ?? null;

  return (
    <section className={`${kioskPanelClassName} flex flex-col gap-4 p-5`} aria-label="置き場所から選ぶ">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12 text-lg`} onClick={onClose}>← 戻る</button>
        <h2 className="text-2xl font-bold text-white">置き場所から選ぶ</h2>
        <p className="ml-auto text-sm text-white/60">途中でタグをかざしても進めます</p>
      </div>
      {loading ? <p className="text-white/70">読み込み中…</p> : null}
      {!loading && areas.length === 0 ? <p className="text-white/70">登録済みの引き出しはありません。</p> : null}
      {area ? (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="エリア">
            <span className="w-16 text-sm text-white/60">エリア</span>
            {areas.map((entry) => (
              <button key={entry.area} type="button" aria-pressed={entry.area === area.area} className={entry.area === area.area ? selectedChoiceClassName : idleChoiceClassName} onClick={() => { setAreaName(entry.area); setShelfNumber(null); }}>
                {entry.area}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="棚">
            <span className="w-16 text-sm text-white/60">棚</span>
            {area.shelves.map((entry) => (
              <button key={entry.shelfNumber} type="button" aria-pressed={entry.shelfNumber === shelf?.shelfNumber} className={entry.shelfNumber === shelf?.shelfNumber ? selectedChoiceClassName : idleChoiceClassName} onClick={() => setShelfNumber(entry.shelfNumber)}>
                棚{entry.shelfNumber}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {shelf ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shelf.compartments.map((compartment) => {
            const photo = compartment.item.photos[0];
            return (
              <button key={compartment.id} type="button" className="flex items-center gap-3 rounded-lg border border-white/15 bg-slate-950/40 p-3 text-left text-white hover:bg-slate-800" onClick={() => onPick(compartment)}>
                {photo
                  ? <img src={inventoryThumbnailUrl(photo.photoUrl)} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
                  : <span className="h-20 w-20 shrink-0 rounded bg-slate-800" aria-hidden="true" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm text-white/60">引出し{compartment.drawerNumber}</span>
                  <span className="truncate text-lg font-bold">{compartment.item.name}</span>
                </span>
                <span className="text-3xl font-bold">{compartment.stockQuantity}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
