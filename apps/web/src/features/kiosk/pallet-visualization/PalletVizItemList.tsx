import clsx from 'clsx';

import { palletVizCopy } from './copy';

export type PalletVizListItem = {
  id: string;
  palletNo: number;
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName?: string | null;
  machineNameDisplay?: string | null;
  plannedStartDateDisplay?: string | null;
  plannedQuantity?: number | null;
  outsideDimensionsDisplay?: string | null;
};

export type PalletVizItemListProps = {
  items: PalletVizListItem[];
  selectedItemId: string | null;
  onToggleItem: (id: string) => void;
};

/**
 * パレット上の部品一覧（タップで選択切替）。データ取得は行わない。
 */
function formatQuantityLabel(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return palletVizCopy.card.emDash;
  return String(q);
}

export function PalletVizItemList({ items, selectedItemId, onToggleItem }: PalletVizItemListProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-md bg-slate-950/50 p-2">
      <ul className="space-y-2">
        {items.map((it) => {
          const selected = it.id === selectedItemId;
          const machineLine = it.machineNameDisplay ?? it.machineName;
          return (
            <li key={it.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onToggleItem(it.id)}
                className={clsx(
                  'flex h-[9.5rem] w-full flex-col rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  selected
                    ? 'border-amber-400 bg-amber-500/20'
                    : 'border-white/10 bg-slate-800/80 hover:border-white/30'
                )}
              >
                <div className="font-mono text-lg font-bold tabular-nums text-amber-200">{it.palletNo}</div>
                <div className="font-mono text-xs text-white/60">{it.fhincd}</div>
                <div className="line-clamp-2 font-semibold leading-snug">{it.fhinmei}</div>
                <div className="font-mono text-xs text-white/85">{it.fseiban}</div>
                {machineLine ? <div className="font-mono text-xs text-white/70">{machineLine}</div> : null}
                <div className="mt-auto grid grid-cols-[2.5rem_1fr] gap-x-2 gap-y-0.5 pt-1 text-xs text-white/75">
                  <span className="text-white/50">{palletVizCopy.card.startDate}</span>
                  <span className="font-mono tabular-nums">
                    {it.plannedStartDateDisplay?.trim() || palletVizCopy.card.emDash}
                  </span>
                  <span className="text-white/50">{palletVizCopy.card.quantity}</span>
                  <span className="font-mono tabular-nums">{formatQuantityLabel(it.plannedQuantity)}</span>
                  <span className="text-white/50">{palletVizCopy.card.outsideDimensions}</span>
                  <span className="min-w-0 truncate font-mono tabular-nums">
                    {it.outsideDimensionsDisplay?.trim() || palletVizCopy.card.emDash}
                  </span>
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
