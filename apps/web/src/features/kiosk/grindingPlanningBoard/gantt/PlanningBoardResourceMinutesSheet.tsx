import { Fragment, useEffect, useRef, useState } from 'react';

import { useUpdateKioskGrindingPlanningBoardResourcePartMinutes } from '../../../../api/hooks/production-schedule';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse, GrindingPlanningBoardResourcePartMinutesRequest } from '@raspi-system/shared-types';

type Op = { opNo: number; minutes: number | null; setupMinutes: number | null };
type Value = { perUnitMinutes: number | null; setupMinutes: number | null; ops: Op[] };
type Saved = GrindingPlanningBoardResourceMinutesResponse['values'][number];
// Keep unfinished edits when the sheet closes or switches machines. Successful saves remove them.
const drafts = new Map<string, Value>();
const half = (value: number) => Math.round(value * 2) / 2;
const empty = (): Value => ({ perUnitMinutes: null, setupMinutes: null, ops: [] });
const fromSaved = (saved?: Saved): Value => saved ? { ...saved, ops: (saved.ops ?? []).map((op) => ({ ...op, setupMinutes: op.setupMinutes ?? null })) } : empty();
const setupOf = (value: Value) => value.ops.length ? value.ops.reduce((sum, op) => sum + (op.setupMinutes ?? 0), 0) : value.setupMinutes ?? 0;
const unitOf = (value: Value) => value.ops.length ? value.ops.reduce((sum, op) => sum + (op.minutes ?? 0), 0) : value.perUnitMinutes;
const complete = (value: Value) => value.ops.length ? value.ops.every((op) => op.minutes !== null && op.minutes >= 0.5) : value.perUnitMinutes !== null;

function Stepper({ label, value, ghost, setup, disabled, invalid, draft, onChange }: {
  label: string; value: number | null; ghost: number | null; setup?: boolean; disabled: boolean; invalid?: boolean; draft?: boolean; onChange: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const normalize = (next: number) => Math.min(100000, Math.max(setup ? 0 : 0.5, setup ? Math.round(next / 5) * 5 : half(next)));
  return <div className={`flex h-[52px] overflow-hidden rounded-lg border-2 bg-slate-950 ${invalid ? 'border-red-400' : value !== null ? 'border-amber-800' : 'border-slate-700'} ${draft ? 'border-dashed' : ''}`}>
    <button type="button" className="h-full w-12 shrink-0 bg-slate-800 text-2xl" aria-label={`${label}を減らす`} disabled={disabled}
      onClick={() => { setEditing(null); onChange(normalize(value === null ? ghost ?? 0 : value - (setup ? 5 : 0.5))); }}>−</button>
    <input type="number" aria-label={label} aria-invalid={invalid || undefined} min={setup ? 0 : 0.5} max={100000} step={setup ? 5 : 0.5} inputMode="decimal" disabled={disabled}
      className="w-[72px] min-w-0 bg-transparent text-center font-mono text-[22px] font-bold text-amber-300 placeholder:font-normal placeholder:text-slate-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      value={editing ?? value ?? ''} placeholder={ghost === null ? '' : String(ghost)} onBlur={() => setEditing(null)}
      onChange={(event) => { const raw = event.target.value; setEditing(raw); if (!raw) onChange(null); else if (Number.isFinite(Number(raw))) onChange(normalize(Number(raw))); }} />
    <button type="button" className="h-full w-12 shrink-0 bg-slate-800 text-2xl" aria-label={`${label}を増やす`} disabled={disabled}
      onClick={() => { setEditing(null); onChange(normalize(value === null ? (setup ? 5 : ghost ?? 0.5) : value + (setup ? 5 : 0.5))); }}>＋</button>
  </div>;
}
function PartRow({ resourceCd, fhincd, items, saved, disabled, columns, selected, select, onOpsChange, hasOps }: {
  resourceCd: string; fhincd: string; items: GrindingPlanningBoardItem[]; saved?: Saved; disabled: boolean; columns: number[];
  selected: boolean; select: () => void; onOpsChange: (ops: number[]) => void; hasOps: boolean;
}) {
  const key = `${resourceCd}:${fhincd}`;
  const mutation = useUpdateKioskGrindingPlanningBoardResourcePartMinutes(resourceCd, fhincd);
  const [draft, setDraft] = useState<Value | null>(() => drafts.get(key) ?? null);
  const [error, setError] = useState(false);
  const value = draft ?? fromSaved(saved);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Value | null>(null);
  const queued = useRef<Value | null>(null);
  const saving = useRef(false);
  const persisted = useRef(Boolean(saved));
  const save = useRef<(next: Value) => void>(() => undefined);
  save.current = (next) => {
    if (saving.current) { queued.current = next; return; }
    saving.current = true;
    const payload: GrindingPlanningBoardResourcePartMinutesRequest = {
      resourceCd, fhincd, perUnitMinutes: unitOf(next), setupMinutes: setupOf(next),
      ops: next.ops.map((op) => ({ ...op, minutes: op.minutes! }))
    };
    void mutation.mutateAsync(payload).then(() => {
      persisted.current = payload.perUnitMinutes !== null;
      setError(false);
      if (drafts.get(key) === next) drafts.delete(key);
    }).catch(() => { setError(true); }).finally(() => {
      saving.current = false;
      const nextQueued = queued.current;
      queued.current = null;
      if (nextQueued) save.current(nextQueued);
    });
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) save.current(pending.current);
  }, []);
  const change = (next: Value, reset = false) => {
    if (setupOf(next) > 100000 || (unitOf(next) ?? 0) > 100000) return;
    select(); setDraft(next); drafts.set(key, next); setError(false);
    onOpsChange(next.ops.map((op) => op.opNo));
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    queued.current = null;
    if (!reset && !complete(next)) return;
    pending.current = next;
    timer.current = setTimeout(() => { pending.current = null; save.current(next); }, 400);
  };
  const quantity = items.reduce((sum, item) => sum + (item.quantity ?? item.plannedQuantity ?? 0), 0);
  const count = new Set(items.map((item) => item.parentItemId ?? item.itemId)).size;
  const original = items.some((item) => item.originalRequiredMinutes !== null) ? items.reduce((sum, item) => sum + (item.originalRequiredMinutes ?? 0), 0) : null;
  const base = original !== null && quantity > 0 ? Math.min(100000, Math.max(0.5, half((original - setupOf(value) * count) / quantity))) : null;
  const unit = unitOf(value) ?? base;
  const touched = value.ops.length > 0 || value.setupMinutes !== null || value.perUnitMinutes !== null;
  const lot = touched && unit !== null ? setupOf(value) * count + unit * quantity : original;
  const reset = () => {
    if (value.ops.length && !window.confirm(`${fhincd} の工程を外して元の値に戻します。全ての片で全工程の完了記録が消えます`)) return;
    change(empty(), true);
  };
  const changeUnit = (minutes: number | null, opNo?: number) => {
    if (minutes === null && opNo === undefined && (persisted.current || saved || saving.current)) { change(empty(), true); return; }
    if (opNo !== undefined) change({ ...value, ops: value.ops.map((op) => op.opNo === opNo ? { ...op, minutes } : op) });
    else change({ ...value, perUnitMinutes: minutes });
  };
  const add = () => {
    if (value.ops.length >= 20) return;
    if (!value.ops.length) change({ ...empty(), ops: [{ opNo: 1, setupMinutes: value.setupMinutes ?? 0, minutes: value.perUnitMinutes ?? base }, { opNo: 2, setupMinutes: null, minutes: null }] });
    else {
      let opNo = 1; while (value.ops.some((op) => op.opNo === opNo)) opNo++;
      change({ ...value, ops: [...value.ops, { opNo, setupMinutes: null, minutes: null }].sort((a, b) => a.opNo - b.opNo) });
    }
  };
  const remove = (op: Op) => {
    if ((op.minutes !== null || op.setupMinutes !== null) && !window.confirm(`${fhincd} の ${op.opNo}工程を外します。全ての片でこの工程の完了記録が消えます`)) return;
    const ops = value.ops.filter((entry) => entry.opNo !== op.opNo);
    change(ops.length ? { ...value, ops } : { ops: [], perUnitMinutes: op.minutes, setupMinutes: op.minutes === null ? null : op.setupMinutes ?? 0 }, !ops.length && op.minutes === null && persisted.current);
  };
  const cell = 'border-b border-slate-700 px-2 py-1.5';
  const bg = selected ? 'bg-[#13213a]' : 'bg-slate-900';
  return <tr onClick={select} onFocus={select} className={bg}>
    <td className={`${cell} sticky left-0 z-10 w-[170px] min-w-[170px] max-w-[170px] ${bg}`}><div className="font-mono text-lg font-bold">{fhincd}</div><div className="truncate text-[13px] text-slate-400">{items[0]?.fhinmei}</div>
      {error && <span role="alert" className="text-xs text-rose-200">保存できませんでした。</span>}</td>
    <td className={`${cell} text-right text-lg`}>{quantity}{count > 1 && <small className="ml-1 text-xs text-slate-400">{count}件</small>}</td>
    <td className={`${cell} text-right text-lg text-slate-400`}>{original !== null && quantity > 0 ? half(original / quantity) : '−'}</td>
    <td className={`${cell} text-right whitespace-nowrap`}>
      {complete(value) && original !== null && lot !== null && Math.abs(lot - original) > Math.max(0.5, quantity * 0.25) && <small className="mr-2 text-sm text-slate-400">{Math.round(original)}→</small>}
      <b className={`text-[22px] ${complete(value) ? '' : 'font-normal text-slate-400'}`}>{lot === null ? '−' : `${Math.round(lot)}分`}</b></td>
    {columns.map((no, index) => {
      const op = value.ops.find((entry) => entry.opNo === no);
      if (!op && (value.ops.length || index > 0)) return <Fragment key={no}><td className={cell} /><td className={cell} /></Fragment>;
      const label = op ? `${fhincd} ${no}工程` : fhincd;
      const remaining = base === null ? null : half(base - value.ops.reduce((sum, other) => sum + (other.opNo === no ? 0 : other.minutes ?? 0), 0));
      return <Fragment key={no}><td className={cell}><Stepper label={`${label} 段取り`} value={op ? op.setupMinutes : value.setupMinutes} ghost={0} setup disabled={disabled}
        onChange={(setupMinutes) => change(op ? { ...value, ops: value.ops.map((entry) => entry.opNo === no ? { ...entry, setupMinutes } : entry) } : { ...value, setupMinutes })} /></td>
      <td className={cell}><div className="flex items-center gap-1.5"><Stepper label={`${label} 1台`} value={op ? op.minutes : value.perUnitMinutes} ghost={op ? remaining !== null && remaining > 0 ? remaining : null : base} disabled={disabled}
        invalid={error || Boolean(op && op.minutes === null)} draft={!op && value.setupMinutes !== null && value.perUnitMinutes === null}
        onChange={(minutes) => changeUnit(minutes, op?.opNo)} />
        {selected && op && <button type="button" aria-label={`${fhincd} ${no}工程を外す`} disabled={disabled} className="h-11 w-10 shrink-0 rounded-lg border-2 border-slate-700 text-xl text-slate-400" onClick={() => remove(op)}>×</button>}</div></td></Fragment>;
    })}
    <td className={`${cell} sticky right-0 z-10 min-w-[240px] ${bg}`}><div className="flex gap-2">
      {hasOps && <button type="button" disabled={disabled || value.ops.length >= 20} className="h-11 w-[104px] rounded-lg border-2 border-dashed border-slate-700 text-slate-400 disabled:opacity-35" onClick={add}>＋工程</button>}
      {selected && touched && <button type="button" disabled={disabled} className="h-11 whitespace-nowrap rounded-lg border-2 border-slate-700 px-3 text-slate-400" onClick={reset}>元に戻す</button>}
    </div></td>
  </tr>;
}
export function PlanningBoardResourceMinutesSheet({ resourceCd, items, values, disabled }: {
  resourceCd: string; items: GrindingPlanningBoardItem[]; values: GrindingPlanningBoardResourceMinutesResponse['values']; disabled: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [opOverrides, setOpOverrides] = useState<Record<string, number[]>>({});
  const groups = new Map<string, GrindingPlanningBoardItem[]>();
  for (const item of items) {
    const fhincd = item.fhincd.trim();
    if (fhincd) groups.set(fhincd, [...(groups.get(fhincd) ?? []), item]);
  }
  const used = new Set<number>();
  for (const fhincd of groups.keys()) {
    const nos = opOverrides[fhincd] ?? drafts.get(`${resourceCd}:${fhincd}`)?.ops.map((op) => op.opNo) ?? values.find((value) => value.resourceCd === resourceCd && value.fhincd === fhincd)?.ops?.map((op) => op.opNo) ?? [];
    nos.forEach((no) => used.add(no));
  }
  const hasOps = resourceCd === '021' || resourceCd === '022' || used.size > 0;
  const columns = used.size ? [...used].sort((a, b) => a - b) : [1];
  const header = 'sticky top-0 z-20 border-b border-slate-700 bg-slate-950 px-2 py-2 text-[15px] font-normal text-slate-400';
  return <div data-planning-board-value-sheet role="region" aria-label="品番の値" className="absolute inset-x-0 bottom-0 z-[60] flex flex-col border-t-[3px] border-amber-400 bg-slate-900 shadow-2xl" style={{ height: 'min(56%, 520px)' }}>
    {selected && <div className="px-4 py-2 break-words text-[17px]"><b className="mr-2 font-mono">{selected}</b>{groups.get(selected)?.[0]?.fhinmei}</div>}
    <div className="min-h-0 overflow-auto"><table className="w-max text-left"><thead><tr>
      <th className={`${header} sticky left-0 z-30`}>品番</th><th className={`${header} text-right`}>数</th><th className={`${header} whitespace-nowrap text-right`}>元/台</th><th className={`${header} min-w-[150px] text-right`}>ロット</th>
      {columns.map((no) => <th key={no} colSpan={2} className={header}>{hasOps && <b className="mb-1 block border-b border-slate-700 pb-1 text-base text-sky-300">{no}工程</b>}<div className="grid grid-cols-[184px_220px]"><span>段取り</span><span>1台</span></div></th>)}
      <th className={`${header} sticky right-0 z-30`} aria-label="操作" />
    </tr></thead><tbody>{[...groups].map(([fhincd, members]) => <PartRow key={`${resourceCd}:${fhincd}`} resourceCd={resourceCd} fhincd={fhincd} items={members}
      saved={values.find((value) => value.resourceCd === resourceCd && value.fhincd === fhincd)} disabled={disabled} columns={columns} hasOps={hasOps} selected={selected === fhincd}
      select={() => setSelected(fhincd)} onOpsChange={(ops) => setOpOverrides((previous) => ({ ...previous, [fhincd]: ops }))} />)}</tbody></table></div>
  </div>;
}
