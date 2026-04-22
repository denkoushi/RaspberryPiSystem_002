import clsx from 'clsx';

import { palletVizCopy } from './copy';

export type PalletVizListItem = {
  id: string;
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName?: string | null;
};

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
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-md bg-slate-950/50 p-2">
      <ul className="space-y-2">
        {items.map((it) => {
          const selected = it.id === selectedItemId;
          return (
            <li key={it.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onToggleItem(it.id)}
                className={clsx(
                  'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  selected
                    ? 'border-amber-400 bg-amber-500/20'
                    : 'border-white/10 bg-slate-800/80 hover:border-white/30'
                )}
              >
                <div className="font-mono text-xs text-white/60">{it.fhincd}</div>
                <div className="font-semibold">{it.fhinmei}</div>
                <div className="text-xs text-white/70">
                  製番 {it.fseiban}
                  {it.machineName ? ` ／ ${it.machineName}` : ''}
                </div>
              </button>
            </li>
          );
        })}
        {items.length === 0 ? (
          <li className="text-sm text-white/50">{palletVizCopy.emptyPallet}</li>
        ) : null}
      </ul>
    </div>
  );
}
