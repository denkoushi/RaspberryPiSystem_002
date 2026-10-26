import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';

import { useDeleteOrderPlacementBranch } from '../../../api/hooks/haizen-overview';
import { mobilePlacementQueryKeys } from '../mobilePlacementQueryKeys';
import { hp } from '../ui/haizenPhoneTokens';

import type { PartPlacementSearchHitDto } from './types';

export function PartSearchPhoneHit({ hit, selected, onSelect, onDeleted }: {
  hit: PartPlacementSearchHitDto; selected: boolean; onSelect: () => void; onDeleted: () => void;
}) {
  const details = [
    ['製造order', hit.manufacturingOrderBarcodeRaw], ['品番', hit.fhincd], ['製番', hit.fseiban],
    ['分配', hit.branchNo === 0 ? 'なし' : hit.branchNo], ['FHINMEI', hit.fhinmei], ['ProductNo', hit.productNo], ['同義語', hit.aliasMatchedBy]
  ];
  return <div className={`rounded-[14px] border ${selected ? 'border-[var(--hp-shelf)] bg-[var(--hp-panel2)]' : 'border-[var(--hp-line)] bg-[var(--hp-panel)]'}`}><button type="button" aria-pressed={selected} aria-expanded={selected} onClick={onSelect}
    className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-px rounded-[14px] bg-[var(--hp-panel)] px-3 py-2.5 text-left aria-pressed:border-[var(--hp-shelf)] aria-pressed:bg-[var(--hp-panel2)]">
    <span className="row-span-2 min-w-[116px] whitespace-nowrap font-mono text-xl font-bold text-[var(--hp-shelf)]">{hit.shelfCodeRaw}</span>
    <span className="truncate text-base font-black">{hit.displayName}</span>
    <span className="truncate font-mono text-xs text-[var(--hp-ink2)]">{hit.fhincd}</span>
    {selected && <span className="col-span-2 mt-2 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-dashed border-[var(--hp-line)] pt-2 font-mono text-xs text-[var(--hp-ink2)]">
      {details.filter(([, value]) => value != null && value !== '').map(([label, value]) =>
        <span key={label} className="break-all">{label} <b className="text-[var(--hp-ink)]">{value}</b></span>)}
    </span>}
  </button>
    {selected && hit.branchStateId != null && <DeletePlacedItem key={hit.branchStateId} id={hit.branchStateId} onDeleted={onDeleted} />}
  </div>;
}

function DeletePlacedItem({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const client = useQueryClient();
  const deletion = useDeleteOrderPlacementBranch();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteItem = async () => {
    if (deletion.isPending) return;
    if (!confirm) { setError(null); setConfirm(true); return; }
    try {
      await deletion.mutateAsync(id);
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.partSearchAll });
      void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.orderPlacementBranchesAll });
      onDeleted();
    } catch (cause) {
      const message = isAxiosError<{ message?: string }>(cause) ? cause.response?.data?.message : undefined;
      setError(message || (cause instanceof Error ? cause.message : '消せませんでした'));
      setConfirm(false);
    }
  };
  return <div className="px-3 pb-2.5">
    <div className="flex gap-2">
      <button type="button" disabled={deletion.isPending} onClick={() => void deleteItem()}
        className={`${hp.mini} ${confirm ? '!bg-[var(--hp-ng)] !text-[var(--hp-bg)] !border-[var(--hp-ng)]' : '!text-[var(--hp-ng)]'}`}>
        {confirm ? '本当に消す' : 'この品物を消す'}
      </button>
      {confirm && <button type="button" className={hp.mini} disabled={deletion.isPending} onClick={() => setConfirm(false)}>やめる</button>}
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-[var(--hp-ng)]">{error}</p>}
  </div>;
}
