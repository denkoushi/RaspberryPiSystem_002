import { useEffect, useRef, useState } from 'react';

import { useUpdateKioskGrindingPlanningBoardResourcePartMinutes } from '../../../../api/hooks/production-schedule';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse } from '@raspi-system/shared-types';

type Value = { perUnitMinutes: number | null; setupMinutes: number };
function Stepper({ label, value, step, disabled, onChange }: { label: string; value: number | null; step: number; disabled: boolean; onChange: (value: number | null) => void }) {
  return <div className="flex h-9 items-center rounded border border-slate-600 bg-slate-950">
    <button type="button" className="h-full w-8 shrink-0 text-lg" aria-label={`${label}を減らす`} disabled={disabled}
      onClick={() => onChange(Math.max(0, (value ?? 0) - step))}>−</button>
    <input type="number" aria-label={label} min={0} max={100000} step={step} inputMode="decimal" disabled={disabled}
      className="w-16 min-w-0 bg-transparent text-center font-mono text-sm [appearance:textfield]" value={value ?? ''}
      onChange={(event) => { const raw = event.target.value; const next = Number(raw); if (!raw) onChange(null); else if (Number.isFinite(next) && next >= 0 && next <= 100000 && (step !== 5 || Number.isInteger(next))) onChange(next); }} />
    <button type="button" className="h-full w-8 shrink-0 text-lg" aria-label={`${label}を増やす`} disabled={disabled}
      onClick={() => onChange(Math.min(100000, (value ?? 0) + step))}>＋</button>
  </div>;
}
function PartRow({ resourceCd, fhincd, items, saved, disabled }: {
  resourceCd: string; fhincd: string; items: GrindingPlanningBoardItem[];
  saved: GrindingPlanningBoardResourceMinutesResponse['values'][number] | undefined; disabled: boolean;
}) {
  const mutation = useUpdateKioskGrindingPlanningBoardResourcePartMinutes(resourceCd, fhincd);
  const [draft, setDraft] = useState<Value | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Value | null>(null);
  const saving = useRef(false);
  const queued = useRef<Value | null>(null);
  const save = useRef<(value: Value) => void>(() => undefined);
  save.current = (value) => {
    if (saving.current) { queued.current = value; return; }
    saving.current = true;
    void mutation.mutateAsync({ resourceCd, fhincd, ...value }).catch(() => {
      // The mutation exposes the error next to this row.
    }).finally(() => {
      saving.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) save.current(next);
    });
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) save.current(pending.current);
  }, []);
  const value = draft ?? saved ?? { perUnitMinutes: null, setupMinutes: 0 };
  const change = (next: Value) => {
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { pending.current = null; save.current(next); }, 400);
  };
  const quantities = items.map((item) => item.quantity ?? item.plannedQuantity);
  const own = value.perUnitMinutes !== null && quantities.every((quantity) => quantity !== null && quantity > 0)
    ? quantities.reduce<number>((sum, quantity) => sum + value.perUnitMinutes! * quantity! + value.setupMinutes, 0) : null;
  return <tr className="border-b border-slate-800 text-sm">
    <td className="px-3 py-2 font-mono font-bold">{fhincd}</td><td className="max-w-48 truncate px-2">{items[0]?.fhinmei}</td>
    <td className="px-2 text-right font-mono">{items.length}</td>
    <td className="px-2 text-right font-mono">{items.reduce((sum, item) => sum + (item.originalRequiredMinutes ?? 0), 0)}分</td>
    <td className="px-2 py-2"><Stepper label={`${fhincd} 1個`} value={value.perUnitMinutes} step={0.5} disabled={disabled}
      onChange={(perUnitMinutes) => change({ ...value, perUnitMinutes })} />
      {mutation.isError && <span role="alert" className="text-xs text-rose-200">保存できませんでした。</span>}</td>
    <td className="px-2"><Stepper label={`${fhincd} 段取り`} value={value.setupMinutes} step={5} disabled={disabled}
      onChange={(setupMinutes) => change({ ...value, setupMinutes: setupMinutes ?? 0 })} /></td>
    <td className="px-3 text-right font-mono font-bold text-amber-300">{own === null ? '' : `${own}分`}</td>
  </tr>;
}
export function PlanningBoardResourceMinutesSheet({ resourceCd, items, values, disabled }: {
  resourceCd: string; items: GrindingPlanningBoardItem[]; values: GrindingPlanningBoardResourceMinutesResponse['values']; disabled: boolean;
}) {
  const groups = new Map<string, GrindingPlanningBoardItem[]>();
  for (const item of items) {
    const fhincd = item.fhincd.trim();
    if (fhincd) groups.set(fhincd, [...(groups.get(fhincd) ?? []), item]);
  }
  return <div data-planning-board-value-sheet role="region" aria-label="品番の値" className="absolute inset-x-0 bottom-0 z-[60] overflow-auto border-t-2 border-amber-400 bg-slate-900 shadow-2xl" style={{ height: 'min(56%, 520px)' }}>
    <table className="w-full whitespace-nowrap text-left"><thead className="sticky top-0 bg-slate-950 text-xs text-slate-400"><tr>
      {['品番', '品名', '件', '元', '1個', '段取り', '独自'].map((heading) => <th key={heading} className="px-2 py-2">{heading}</th>)}
    </tr></thead><tbody>{[...groups].map(([fhincd, members]) => <PartRow key={`${resourceCd}:${fhincd}`} resourceCd={resourceCd} fhincd={fhincd} items={members}
      saved={values.find((value) => value.resourceCd === resourceCd && value.fhincd === fhincd)} disabled={disabled} />)}</tbody></table>
  </div>;
}
