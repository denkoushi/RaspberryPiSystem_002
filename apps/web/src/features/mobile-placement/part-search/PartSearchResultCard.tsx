import clsx from 'clsx';

import type { PartPlacementSearchHitDto } from './types';

type Props = {
  hit: PartPlacementSearchHitDto;
  selected?: boolean;
  onSelect?: () => void;
};

/**
 * 登録済み（現在棚）候補のカード。
 */
export function PartSearchResultCard(props: Props) {
  const { hit, selected, onSelect } = props;
  const shelf = hit.shelfCodeRaw?.trim() ?? '';

  const body = (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {hit.aliasMatchedBy ? (
          <span className="truncate text-[10px] text-slate-400" title={hit.aliasMatchedBy}>
            同義語: {hit.aliasMatchedBy}
          </span>
        ) : null}
      </div>
      <div className="truncate text-base font-semibold text-white">{hit.displayName}</div>
      {shelf.length > 0 ? <div className="text-lg font-bold tracking-wide text-emerald-300">棚 {shelf}</div> : null}
      <div className="grid grid-cols-1 gap-0.5 text-[11px] text-slate-400 sm:grid-cols-2">
        {hit.manufacturingOrderBarcodeRaw ? (
          <span>製造order: {hit.manufacturingOrderBarcodeRaw}</span>
        ) : null}
        {hit.branchNo != null ? <span>枝番: {hit.branchNo}</span> : null}
        {hit.fhinmei ? <span className="truncate">FHINMEI: {hit.fhinmei}</span> : null}
        {hit.fhincd ? <span>FHINCD: {hit.fhincd}</span> : null}
        {hit.fseiban ? <span>製番: {hit.fseiban}</span> : null}
        {hit.productNo ? <span>ProductNo: {hit.productNo}</span> : null}
      </div>
    </div>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          'w-full rounded-xl border px-3 py-3 text-left transition-colors',
          selected
            ? 'border-sky-400/60 bg-sky-500/10'
            : 'border-white/10 bg-slate-900/40 active:bg-slate-800/80'
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className={clsx(
        'w-full rounded-xl border px-3 py-3 text-left',
        selected ? 'border-sky-400/60 bg-sky-500/10' : 'border-white/10 bg-slate-900/40'
      )}
    >
      {body}
    </div>
  );
}
