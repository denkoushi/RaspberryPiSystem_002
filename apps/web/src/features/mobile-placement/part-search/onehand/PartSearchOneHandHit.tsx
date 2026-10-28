import { useRef, useState } from 'react';

import { hp } from '../../ui/haizenPhoneTokens';

import { PART_SEARCH_FIELD_LABELS, PartSearchFieldIcon } from './PartSearchFieldIcon';

import type { PartSearchFilter, PartSearchRow } from '@raspi-system/part-search-core';

export function PartSearchOneHandHit({ row, selected, filters, onSelect, onFilter, onDelete }: {
  row: PartSearchRow; selected: boolean; filters: PartSearchFilter[];
  onSelect: () => void; onFilter: (filter: PartSearchFilter) => void; onDelete: (row: PartSearchRow) => Promise<void>;
}) {
  const tags: PartSearchFilter[] = [
    { field: 'machine', value: row.machineName }, { field: 'seiban', value: row.fseiban }, { field: 'hinban', value: row.fhincd }
  ];
  return <article className={`shrink-0 rounded-[14px] border ${selected ? 'border-[var(--hp-shelf)] bg-[var(--hp-panel2)]' : 'border-[var(--hp-line)] bg-[var(--hp-panel)]'}`}>
    <button type="button" aria-label={`${row.shelfCodeRaw ?? ''} ${row.fhinmei}`.trim()} aria-expanded={selected} onClick={onSelect}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 rounded-[14px] px-3 py-2.5 text-left">
      <span className="min-w-[92px] whitespace-nowrap font-mono text-xl font-extrabold text-[var(--hp-shelf)]">{row.shelfCodeRaw}</span>
      <span className="truncate text-base font-black">{row.fhinmei}</span>
    </button>
    <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
      {tags.filter((tag) => tag.value).map((tag) => <button key={tag.field} type="button"
        aria-label={`${PART_SEARCH_FIELD_LABELS[tag.field]} ${tag.value} でしぼる`}
        aria-pressed={filters.some((filter) => filter.field === tag.field && filter.value === tag.value)} onClick={() => onFilter(tag)}
        className="inline-flex h-[30px] items-center gap-1 rounded-[9px] border border-[var(--hp-line)] bg-[var(--hp-bg)] px-[9px] font-mono text-xs font-bold text-[var(--hp-ink2)] aria-pressed:border-[var(--hp-ink)] aria-pressed:text-[var(--hp-ink)]">
        <PartSearchFieldIcon field={tag.field} />{tag.value}
      </button>)}
    </div>
    {selected && <>
      <div className="mx-3 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-dashed border-[var(--hp-line)] py-2 font-mono text-xs text-[var(--hp-ink2)]">
        {row.manufacturingOrder && <span>製造order <b className="text-[var(--hp-ink)]">{row.manufacturingOrder}</b></span>}
        {row.branchNo != null && <span>分配 <b className="text-[var(--hp-ink)]">{row.branchNo === 0 ? 'なし' : row.branchNo}</b></span>}
      </div>
      <DeleteItem row={row} onDelete={onDelete} />
    </>}
  </article>;
}

// Keep the phone hit's wording and confirmation lifecycle without its API hooks.
function DeleteItem({ row, onDelete }: { row: PartSearchRow; onDelete: (row: PartSearchRow) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const deleteItem = async () => {
    if (busy.current) return;
    if (!confirm) { setError(null); setConfirm(true); return; }
    busy.current = true;
    setPending(true);
    try {
      await onDelete(row);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '消せませんでした');
      setConfirm(false);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return <div className="px-3 pb-2.5">
    <div className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => void deleteItem()}
        className={`${hp.mini} ${confirm ? '!border-[var(--hp-ng)] !bg-[var(--hp-ng)] !text-[var(--hp-bg)]' : '!text-[var(--hp-ng)]'}`}>
        {confirm ? '本当に消す' : 'この品物を消す'}
      </button>
      {confirm && <button type="button" className={hp.mini} disabled={pending} onClick={() => setConfirm(false)}>やめる</button>}
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-[var(--hp-ng)]">{error}</p>}
  </div>;
}
