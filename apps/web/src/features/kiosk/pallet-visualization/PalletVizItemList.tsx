import { palletVizCopy } from './copy';
import { PalletVizItemCard } from './PalletVizItemCard';

import type { PalletVizListItem } from './palletVizListItem';

export type { PalletVizListItem } from './palletVizListItem';

export type PalletVizItemListProps = {
  items: PalletVizListItem[];
  selectedItemId: string | null;
  onToggleItem: (id: string) => void;
};

/**
 * パレット上の部品一覧（タップで選択切替）。データ取得は行わない。
 */
export function PalletVizItemList({ items, selectedItemId, onToggleItem }: PalletVizItemListProps) {
  return (
    <div
      data-pallet-viz-item-list-scroll
      className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] rounded-md bg-slate-950/50 p-2"
    >
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id}>
            <PalletVizItemCard
              item={it}
              selected={it.id === selectedItemId}
              onToggle={() => onToggleItem(it.id)}
            />
          </li>
        ))}
        {items.length === 0 ? <li className="text-sm text-white/50">{palletVizCopy.emptyPallet}</li> : null}
      </ul>
    </div>
  );
}
