import { formatInventoryLabelNumber } from '@raspi-system/shared-types';
import { useState, type ReactNode } from 'react';

import { inventoryThumbnailUrl, type InventoryItem } from '../../../../api/client';
import { splitArea } from '../areaNaming';
import { invButtonSm, invField, invLabelNumber, invPanel, invSeg } from '../inventoryUi';

type Scope = 'machine' | 'all';

export function filterExistingItems(items: InventoryItem[], { query, scope, machine }: { query: string; scope: Scope; machine: string }): InventoryItem[] {
  const text = query.trim().toLowerCase();
  const digits = text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  return items.filter((item) => {
    if (scope === 'machine' && !item.compartments.some((compartment) => splitArea(compartment.area).machine === machine)) return false;
    return !text
      || [item.name, item.model, item.maker, item.itemCode, item.toolName].some((value) => value?.toLowerCase().includes(text))
      || (/^\d+$/.test(digits) && item.compartments.some(({ labelNumber }) => (
        formatInventoryLabelNumber(labelNumber).startsWith(digits) || Number(digits) === labelNumber
      )));
  });
}

function ItemPhoto({ item, className }: { item: InventoryItem; className: string }) {
  return item.photos[0]
    ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(item.photos[0].photoUrl)} alt="" className={`${className} shrink-0 rounded-lg object-cover`} />
    : <span className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-inv-s3 text-xs text-inv-faint`}>写真なし</span>;
}

function ItemLocation({ item, showArea }: { item: InventoryItem; showArea: boolean }) {
  const compartment = item.compartments[0];
  if (!compartment) return null;
  return <span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-inv-muted">
    <span className={`${invLabelNumber} shrink-0`}>{formatInventoryLabelNumber(compartment.labelNumber)}</span>
    <span className="truncate">{showArea ? `${compartment.area}・` : ''}棚{compartment.shelfNumber}・引き出し{compartment.drawerNumber}</span>
  </span>;
}

export function InventoryExistingItemPicker({ items, isLoading, machine, selectedItem, stepMark, onChoose, onClear }: {
  items: InventoryItem[];
  isLoading: boolean;
  machine: string;
  selectedItem: InventoryItem | undefined;
  stepMark: ReactNode;
  onChoose: (item: InventoryItem) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  // A null choice follows the default even when items arrive after the panel mounts.
  const [chosenScope, setChosenScope] = useState<Scope | null>(null);
  const machineCount = filterExistingItems(items, { query: '', scope: 'machine', machine }).length;
  const scope = chosenScope ?? (machineCount ? 'machine' : 'all');
  const filteredItems = filterExistingItems(items, { query, scope, machine });

  return (
    <section aria-label="追加先のアイテム" className={`${invPanel} flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 p-3.5`}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">{stepMark}<h3 className="text-[15px] font-black">追加先を選ぶ</h3></div>
        <span className="text-sm text-inv-muted">{filteredItems.length} 件</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input aria-label="追加先を探す" placeholder="名前・型式・メーカー・番号で探す" className={`${invField} h-11 min-h-11 min-w-0 flex-1`} value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" aria-pressed={scope === 'machine'} className={`${invSeg(scope === 'machine')} min-h-11 shrink-0 whitespace-nowrap`} onClick={() => setChosenScope('machine')}>この加工機 {machineCount}</button>
        <button type="button" aria-pressed={scope === 'all'} className={`${invSeg(scope === 'all')} min-h-11 shrink-0 whitespace-nowrap`} onClick={() => setChosenScope('all')}>すべて {items.length}</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto">
        {isLoading || !filteredItems.length ? <p className="col-span-2 py-8 text-center text-inv-faint">{isLoading ? '読み込み中…' : '見つかりません'}</p> : filteredItems.map((item) => {
          const selected = item.id === selectedItem?.id;
          return <button key={item.id} type="button" aria-pressed={selected} onClick={() => onChoose(item)} className={`relative grid min-h-[104px] min-w-0 grid-cols-[84px_minmax(0,1fr)] items-center gap-2 rounded-xl text-left ${selected ? 'border-2 border-inv-cyan bg-inv-cyan/[0.12] p-[9px]' : 'border border-inv-line bg-inv-bg p-2.5 hover:bg-inv-s2'}`}>
            <ItemPhoto item={item} className="h-[84px] w-[84px]" />
            <span className="min-w-0 pr-6">
              <span className="line-clamp-2 break-all text-[17px] font-black leading-tight">{item.name}</span>
              {item.model || item.maker ? <span className="mt-1 block truncate text-xs text-inv-muted"><span className="font-mono">{item.model}</span>{item.model && item.maker ? '・' : ''}{item.maker}</span> : null}
              <ItemLocation item={item} showArea={scope === 'all'} />
              <span className="mt-1 block text-xs text-inv-faint">写真 {item.photos.length} 枚</span>
            </span>
            {selected ? <span aria-hidden="true" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-inv-cyan text-sm font-black text-inv-cyan-ink">✓</span> : null}
          </button>;
        })}
      </div>
      <div className="flex h-[132px] shrink-0 items-center gap-3 border-t border-inv-line pt-2.5">
        {selectedItem ? <>
          <ItemPhoto item={selectedItem} className="h-[110px] w-[110px]" />
          <div className="min-w-0 flex-1">
            <span className="text-[13px] text-inv-muted">左の写真と見比べる</span>
            <p className="truncate text-lg font-black">{selectedItem.name}</p>
            <ItemLocation item={selectedItem} showArea />
          </div>
          <button type="button" className={`${invButtonSm} min-h-11`} onClick={onClear}>選び直す</button>
        </> : <p className="text-sm text-inv-faint">選ぶと、ここに今の写真が出ます</p>}
      </div>
    </section>
  );
}
