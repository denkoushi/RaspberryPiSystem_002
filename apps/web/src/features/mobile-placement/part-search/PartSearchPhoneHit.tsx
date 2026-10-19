import type { PartPlacementSearchHitDto } from './types';

export function PartSearchPhoneHit({ hit, selected, onSelect }: {
  hit: PartPlacementSearchHitDto; selected: boolean; onSelect: () => void;
}) {
  const details = [
    ['製造order', hit.manufacturingOrderBarcodeRaw], ['品番', hit.fhincd], ['製番', hit.fseiban],
    ['枝番', hit.branchNo], ['FHINMEI', hit.fhinmei], ['ProductNo', hit.productNo], ['同義語', hit.aliasMatchedBy]
  ];
  return <button type="button" aria-pressed={selected} aria-expanded={selected} onClick={onSelect}
    className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-px rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] px-3 py-2.5 text-left aria-pressed:border-[var(--hp-shelf)] aria-pressed:bg-[var(--hp-panel2)]">
    <span className="row-span-2 min-w-[116px] whitespace-nowrap font-mono text-xl font-bold text-[var(--hp-shelf)]">{hit.shelfCodeRaw}</span>
    <span className="truncate text-base font-black">{hit.displayName}</span>
    <span className="truncate font-mono text-xs text-[var(--hp-ink2)]">{hit.fhincd}</span>
    {selected && <span className="col-span-2 mt-2 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-dashed border-[var(--hp-line)] pt-2 font-mono text-xs text-[var(--hp-ink2)]">
      {details.filter(([, value]) => value != null && value !== '').map(([label, value]) =>
        <span key={label} className="break-all">{label} <b className="text-[var(--hp-ink)]">{value}</b></span>)}
    </span>}
  </button>;
}
