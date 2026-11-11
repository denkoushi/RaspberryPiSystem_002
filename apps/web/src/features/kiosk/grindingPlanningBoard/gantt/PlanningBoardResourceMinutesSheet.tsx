import { isAxiosError } from 'axios';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUpdateKioskGrindingPlanningBoardResourcePartMinutes } from '../../../../api/hooks/production-schedule';
import { usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';
import { isPlanningBoardUnitSplitEnabled } from '../planningBoardUnitSplitPolicy';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse, GrindingPlanningBoardResourcePartMinutesRequest } from '@raspi-system/shared-types';

type Op = { opNo: number; minutes: number | null; setupMinutes: number | null };
type Snapshot = NonNullable<GrindingPlanningBoardResourcePartMinutesRequest['expectedMinutes']>;
type Read = { baseMinutes: Snapshot | null; baseOpIds: string[] };
type Value = { baseMinutes: Snapshot | null; perUnitMinutes: number | null; setupMinutes: number | null; ops: Op[]; baseOpIds: string[]; baseOpNos: number[]; usedOpNos: number[]; invalidFields?: string[]; saveBlocked?: boolean; awaitingRead?: { ignoredReads: Read[]; pending: boolean }; clearOps?: boolean; resetRow?: boolean };
type Saved = GrindingPlanningBoardResourceMinutesResponse['values'][number];
// Keep unfinished edits and offline saves awaiting their read snapshot across sheet closes.
const drafts = new Map<string, Value>();
type SaveQueue = {
  uncertain?: GrindingPlanningBoardResourcePartMinutesRequest;
  saving: boolean;
  failed: boolean;
  queued: (() => void) | null;
  listeners: Set<(next: Value, failed: boolean, discard: boolean) => void>;
};
const queues = new Map<string, SaveQueue>();
function queueFor(key: string): SaveQueue {
  let queue = queues.get(key);
  if (!queue) {
    queue = { failed: false, saving: false, queued: null, listeners: new Set() };
    queues.set(key, queue);
  }
  return queue;
}
function releaseQueue(key: string, queue: SaveQueue) {
  if (queues.get(key) === queue && !queue.listeners.size && !queue.saving && !queue.queued && !queue.failed && !drafts.has(key)) queues.delete(key);
}
const half = (value: number) => Math.round(value * 2) / 2;
const empty = (): Value => ({ baseMinutes: null, perUnitMinutes: null, setupMinutes: null, ops: [], baseOpIds: [], baseOpNos: [], usedOpNos: [] });
const opIds = (saved?: Saved) => (saved?.ops ?? []).flatMap((op) => op.id ? [op.id] : []);
const fromSaved = (saved?: Saved): Value => {
  const baseOpNos = (saved?.ops ?? []).map((op) => op.opNo);
  if (!saved) return empty();
  const ops = (saved.ops ?? []).map((op) => ({ ...op, setupMinutes: op.setupMinutes ?? null }));
  return {
    ...saved,
    baseMinutes: {
      perUnitMinutes: saved.perUnitMinutes,
      setupMinutes: saved.setupMinutes,
      ops: ops.map((op) => ({ opNo: op.opNo, minutes: op.minutes, setupMinutes: op.setupMinutes }))
    },
    baseOpIds: opIds(saved),
    baseOpNos,
    usedOpNos: baseOpNos,
    ops
  };
};
function sameRead(left: Read, right: Read) {
  const a = left.baseMinutes;
  const b = right.baseMinutes;
  const close = (x: number | null, y: number | null) => x === null || y === null ? x === y : Math.abs(x - y) <= 1e-6;
  return left.baseOpIds.length === right.baseOpIds.length && left.baseOpIds.every((id) => right.baseOpIds.includes(id)) &&
    (a === null || b === null ? a === b : close(a.perUnitMinutes, b.perUnitMinutes) && close(a.setupMinutes, b.setupMinutes) &&
      a.ops.length === b.ops.length && a.ops.every((op) => {
        const other = b.ops.find((entry) => entry.opNo === op.opNo);
        return other && close(op.minutes, other.minutes) && close(op.setupMinutes, other.setupMinutes);
      }));
}

const setupOf = (value: Value) => value.ops.length ? value.ops.reduce((sum, op) => sum + (op.setupMinutes ?? 0), 0) : value.setupMinutes ?? 0;
const unitOf = (value: Value) => value.ops.length ? value.ops.reduce((sum, op) => sum + (op.minutes ?? 0), 0) : value.perUnitMinutes;
const complete = (value: Value) => value.ops.length ? value.ops.every((op) => op.minutes !== null && op.minutes > 0) : value.perUnitMinutes !== null;

function Stepper({ label, value, ghost, setup, disabled, invalid, draft, positive, max = 100000, onChange }: {
  label: string; value: number | null; ghost: number | null; setup?: boolean; disabled: boolean; invalid?: boolean; draft?: boolean; positive?: boolean; max?: number; onChange: (value: number | null, invalid?: boolean, cancelSave?: boolean) => void;
}) {
  const { gate } = usePlanningBoardOffline();
  const [editing, setEditing] = useState<string | null>(null);
  const valid = (raw: string) => {
    const next = Number(raw);
    return Number.isFinite(next) && next <= max && (positive ? next > 0 : next >= 0) && (!setup || Number.isInteger(next));
  };
  if (editing !== null && editing !== '' && valid(editing) && Number(editing) !== value) setEditing(null);
  const inputInvalid = invalid || (editing !== null && editing !== '' && !valid(editing));
  const normalize = (next: number) => Math.min(100000, Math.max(setup ? 0 : 0.5, setup ? Math.round(next / 5) * 5 : half(next)));
  return <div className={`flex h-[52px] overflow-hidden rounded-lg border-2 bg-slate-950 ${inputInvalid ? 'border-red-400' : value !== null ? 'border-amber-800' : 'border-slate-700'} ${draft ? 'border-dashed' : ''}`}>
    <button type="button" className="h-full w-12 shrink-0 bg-slate-800 text-2xl" aria-label={`${label}を減らす`} disabled={disabled}
      onClick={() => {
        if (!gate.attempt()) return;
        setEditing(null);
        if (value !== null && value - (setup ? 5 : 0.5) < (setup ? 0 : 0.5)) return;
        const next = normalize(value === null ? ghost ?? 0 : value - (setup ? 5 : 0.5));
        if (value === null || next < value) onChange(next);
      }}>−</button>
    <input type="number" aria-label={label} aria-invalid={inputInvalid || undefined} min={0} max={100000} step={setup ? 5 : 0.5} inputMode="decimal" disabled={disabled}
      className="w-[72px] min-w-0 bg-transparent text-center font-mono text-[22px] font-bold text-amber-300 placeholder:font-normal placeholder:text-slate-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      value={editing ?? value ?? ''} placeholder={ghost === null ? '' : String(ghost)} onBlur={() => { if (!gate.canWrite()) return; setEditing(null); if (editing !== null && editing !== '' && !valid(editing)) onChange(value); }}
      onChange={(event) => { if (!gate.attempt()) return; const raw = event.target.value; setEditing(raw); if (!raw) onChange(null); else if (valid(raw)) onChange(Number(raw)); else onChange(value, true); }} />
    <button type="button" className="h-full w-12 shrink-0 bg-slate-800 text-2xl" aria-label={`${label}を増やす`} disabled={disabled}
      onClick={() => { if (!gate.attempt()) return; setEditing(null); onChange(normalize(value === null ? (setup ? 5 : ghost ?? 0.5) : value + (setup ? 5 : 0.5))); }}>＋</button>
  </div>;
}
const PartRow = memo(function PartRow({ resourceCd, fhincd, items, saved, disabled, columns, selected, select, onOpsChange, hasOps }: {
  resourceCd: string; fhincd: string; items: GrindingPlanningBoardItem[]; saved?: Saved; disabled: boolean; columns: number[];
  selected: boolean; select: (fhincd: string) => void; onOpsChange: (fhincd: string, ops: number[] | undefined) => void; hasOps: boolean;
}) {
  const offline = usePlanningBoardOffline();
  const { gate, frozen } = offline;
  const key = `${resourceCd}:${fhincd}`;
  const mutation = useUpdateKioskGrindingPlanningBoardResourcePartMinutes(resourceCd, fhincd);
  const [draft, setDraft] = useState<Value | null>(() => drafts.get(key) ?? null);
  const [error, setError] = useState(() => queueFor(key).failed);
  const [inputVersion, setInputVersion] = useState(0);
  const value = draft ?? fromSaved(saved);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Value | null>(null);
  const queue = useMemo(() => queueFor(key), [key]);
  const wasFrozen = useRef(frozen);
  useEffect(() => {
    if (wasFrozen.current && !frozen) {
      setDraft(null); setError(false); setInputVersion((version) => version + 1);
      onOpsChange(fhincd, undefined);
    }
    wasFrozen.current = frozen;
  }, [frozen, fhincd, onOpsChange]);
  const opsChange = useRef(onOpsChange);
  opsChange.current = onOpsChange;
  const persisted = useRef(Boolean(saved));
  const save = useRef<(next: Value) => void>(() => undefined);
  save.current = (next) => {
    if (!gate.canWrite()) return;
    const generation = gate.generation();
    if (drafts.get(key) !== next || next.awaitingRead?.pending || next.saveBlocked || (!next.resetRow && !complete(next))) return;
    if (queue.saving) { queue.queued = () => save.current(next); return; }
    queue.saving = true;
    const payload: GrindingPlanningBoardResourcePartMinutesRequest = {
      resourceCd, fhincd, perUnitMinutes: unitOf(next), setupMinutes: setupOf(next), expectedOpIds: next.baseOpIds, expectedMinutes: next.baseMinutes,
      ...(next.ops.length || next.clearOps || unitOf(next) === null ? { ops: next.ops.map((op) => ({ opNo: op.opNo, setupMinutes: op.setupMinutes, minutes: op.minutes! })) } : {})
    };
    const rememberRead = (response: GrindingPlanningBoardResourceMinutesResponse, pending: boolean) => {
      const current = drafts.get(key);
      if (current && offline.enabled && response.savedMinutes !== undefined) {
        const ignoredReads = current.awaitingRead?.ignoredReads ?? [
          { baseMinutes: current.baseMinutes, baseOpIds: current.baseOpIds }
        ];
        current.awaitingRead = { pending, ignoredReads: [...ignoredReads,
          { baseMinutes: response.savedMinutes, baseOpIds: response.savedOpIds ?? current.baseOpIds }] };
      }
    };
    let attempted = payload;
    void gate.run(async () => {
      if (queue.uncertain) {
        attempted = queue.uncertain;
        try {
          const response = await mutation.mutateAsync(attempted);
          if (generation !== gate.generation()) return response;
          delete queue.uncertain;
          if (JSON.stringify(payload) === JSON.stringify(attempted)) return response;
          const current = drafts.get(key);
          rememberRead(response, false);
          if (response.savedMinutes !== undefined) {
            payload.expectedMinutes = response.savedMinutes;
            if (current) current.baseMinutes = response.savedMinutes;
          }
          if (response.savedOpIds !== undefined) {
            payload.expectedOpIds = response.savedOpIds;
            if (current) current.baseOpIds = response.savedOpIds;
            if (current && response.savedOpNos !== undefined) current.baseOpNos = response.savedOpNos;
          }
        } catch (error: unknown) {
          const status = isAxiosError(error) ? error.response?.status : undefined;
          if (generation !== gate.generation() || status === undefined || status < 500 || status >= 600) throw error;
          delete queue.uncertain;
        }
      }
      attempted = payload;
      return mutation.mutateAsync(payload);
    }).then(async (response) => {
      if (generation !== gate.generation()) return;
      persisted.current = payload.perUnitMinutes !== null;
      queue.failed = false;
      const current = drafts.get(key);
      rememberRead(response, current === next);
      if (current && response.savedMinutes !== undefined) current.baseMinutes = response.savedMinutes;
      if (current && response.savedOpIds !== undefined) {
        // Queued saves hold this same draft object, including while the sheet is closed.
        current.baseOpIds = response.savedOpIds;
        if (response.savedOpNos !== undefined) current.baseOpNos = response.savedOpNos;
      }
      if (drafts.get(key) === next) {
        if (offline.enabled && response.savedMinutes !== undefined) {
          drafts.set(key, { ...next });
          queue.listeners.forEach((notify) => notify(next, false, false));
        } else {
          drafts.delete(key);
          queue.listeners.forEach((notify) => notify(next, false, true));
        }
      } else queue.listeners.forEach((notify) => notify(next, false, false));
      if (offline.enabled) {
        const results = await Promise.allSettled(['board', 'load', 'resource-minutes'].map((readKey) => offline.refreshRead(readKey)));
        results.forEach((result) => {
          if (result.status === 'rejected') console.warn('Planning board refresh after saving minutes failed', result.reason);
        });
      }
    }).catch((error: unknown) => {
      if (generation !== gate.generation()) return;
      const discard = isAxiosError(error) && error.response?.status === 409 &&
        ['OPERATION_SET_CHANGED', 'RESOURCE_MINUTES_CHANGED'].includes(error.response.data?.errorCode);
      if (discard) {
        drafts.delete(key); queue.queued = null; delete queue.uncertain;
        if (offline.enabled) void offline.refreshRead('resource-minutes').catch((reason: unknown) => {
          console.warn('Planning board refresh after minutes conflict failed', reason);
        });
      }
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (!discard && (status === undefined || status >= 500)) queue.uncertain = attempted;
      else if (queue.uncertain === attempted) delete queue.uncertain;
      queue.failed = true;
      queue.listeners.forEach((notify) => notify(next, true, discard));
    }).finally(() => {
      queue.saving = false;
      const nextQueued = queue.queued;
      queue.queued = null;
      if (generation === gate.generation() && gate.canWrite()) nextQueued?.();
      releaseQueue(key, queue);
    });
  };
  useEffect(() => {
    // StrictMode can release this queue during effect cleanup; reuse the rendered queue.
    queues.set(key, queue);
    const notify = (_next: Value, failed: boolean, discard: boolean) => {
      setError(failed);
      if (!discard) setDraft(drafts.get(key) ?? null);
      if (discard) {
        setDraft(null); opsChange.current(fhincd, undefined);
        if (failed) setInputVersion((version) => version + 1);
      }
    };
    queue.listeners.add(notify);
    const restored = drafts.get(key);
    if (restored && !restored.saveBlocked && (complete(restored) || restored.resetRow) && !queue.saving) save.current(restored);
    return () => {
      queue.listeners.delete(notify);
      if (timer.current) clearTimeout(timer.current);
      const current = drafts.get(key);
      if (current && (current.invalidFields?.length || current.saveBlocked)) {
        // Unmounted inputs discard their raw text, just as they do on blur.
        const restored = { ...current };
        delete restored.invalidFields;
        delete restored.saveBlocked;
        drafts.set(key, restored);
        if (complete(restored) || restored.resetRow) save.current(restored);
      } else if (pending.current) save.current(pending.current);
      releaseQueue(key, queue);
    };
  }, [key, fhincd, queue]);
  useEffect(() => {
    if (!draft?.awaitingRead?.pending) return;
    const read = fromSaved(saved);
    if (!sameRead(draft, read) && draft.awaitingRead.ignoredReads.some((ignored) => sameRead(ignored, read))) return;
    if (drafts.get(key) !== draft) return;
    drafts.delete(key);
    setDraft(null);
    onOpsChange(fhincd, undefined);
    releaseQueue(key, queue);
  }, [draft, saved, key, fhincd, onOpsChange, queue]);
  useEffect(() => {
    const discard = () => {
      if (timer.current) clearTimeout(timer.current);
      pending.current = null;
      queue.queued = null;
      delete queue.uncertain;
      drafts.delete(key);
    };
    if (frozen) discard();
    return gate.subscribeReadOnly(discard);
  }, [frozen, gate, key, queue]);
  const change = (next: Value, reset = false, clearOps = false, cancelSave = false) => {
    if (!gate.attempt()) return;
    next.awaitingRead = value.awaitingRead ? { ...value.awaitingRead, pending: false } : undefined;
    next.baseMinutes = value.baseMinutes;
    next.baseOpIds = value.baseOpIds;
    next.baseOpNos = value.baseOpNos;
    next.usedOpNos = [...new Set([...value.usedOpNos, ...value.baseOpNos, ...next.ops.map((op) => op.opNo)])];
    next.resetRow = reset;
    next.saveBlocked = cancelSave || Boolean(next.invalidFields?.length);
    if (clearOps) next.clearOps = true;
    if (next.ops.length) next.clearOps = false;
    if (setupOf(next) > 100000 || (unitOf(next) ?? 0) > 100000) return;
    select(fhincd); setDraft(next); drafts.set(key, next);
    onOpsChange(fhincd, next.ops.map((op) => op.opNo));
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    queue.queued = null;
    if (next.saveBlocked || (!next.resetRow && !complete(next))) return;
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
    if (!gate.attempt()) return;
    if ((saved?.ops?.length ?? 0) > 0 && !window.confirm(`${fhincd} の工程を外して元の値に戻します。全ての片で全工程の完了記録が消えます`)) return;
    change(empty(), true, true);
  };
  const changeField = (next: Value, field: string, invalid = false, cancelSave = false) => {
    next.invalidFields = [...(value.invalidFields ?? []).filter((entry) => entry !== field), ...(invalid ? [field] : [])];
    change(next, false, false, cancelSave);
  };
  const changeUnit = (minutes: number | null, opNo?: number, invalid = false, cancelSave = false) => {
    if (opNo !== undefined) changeField({ ...value, ops: value.ops.map((op) => op.opNo === opNo ? { ...op, minutes } : op) }, `${opNo}:unit`, invalid, cancelSave);
    else changeField({ ...value, perUnitMinutes: minutes }, `unit`, invalid, cancelSave);
  };
  const add = () => {
    if (value.ops.length >= 20) return;
    const used = new Set([...value.usedOpNos, ...value.baseOpNos, ...value.ops.map((op) => op.opNo)]);
    const nextNumber = () => {
      let no = Math.max(0, ...used) + 1;
      if (no > 20) {
        no = 1;
        while (used.has(no) && no <= 20) no++;
      }
      if (no > 20) return null;
      used.add(no);
      return no;
    };
    const first = nextNumber();
    if (first === null) return;
    if (!value.ops.length) {
      const second = nextNumber();
      change({ ...empty(), ops: [
        { opNo: first, setupMinutes: value.setupMinutes ?? 0, minutes: value.perUnitMinutes },
        ...(second === null ? [] : [{ opNo: second, setupMinutes: null, minutes: null }])
      ].sort((a, b) => a.opNo - b.opNo) });
    } else change({ ...value, ops: [...value.ops, { opNo: first, setupMinutes: null, minutes: null }].sort((a, b) => a.opNo - b.opNo) });
  };
  const remove = (op: Op) => {
    if (!gate.attempt()) return;
    if (saved?.ops?.some((entry) => entry.opNo === op.opNo) && !window.confirm(`${fhincd} の ${op.opNo}工程を外します。全ての片でこの工程の完了記録が消えます`)) return;
    const ops = value.ops.filter((entry) => entry.opNo !== op.opNo);
    change(ops.length ? { ...value, ops, invalidFields: value.invalidFields?.filter((field) => !field.startsWith(`${op.opNo}:`)) } : { ...empty(), perUnitMinutes: op.minutes, setupMinutes: op.minutes === null ? null : op.setupMinutes ?? 0 }, !ops.length && op.minutes === null && persisted.current, !ops.length);
  };
  const cell = 'border-b border-slate-700 px-2 py-1.5';
  const bg = selected ? 'bg-[#13213a]' : 'bg-slate-900';
  return <tr onClick={() => select(fhincd)} onFocus={() => select(fhincd)} className={bg}>
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
      return <Fragment key={`${op ? no : 'single'}:${inputVersion}`}><td className={cell}><Stepper label={`${label} 段取り`} value={op ? op.setupMinutes : value.setupMinutes} ghost={0} setup disabled={disabled}
        max={op ? 100000 - setupOf(value) + (op.setupMinutes ?? 0) : 100000}
        onChange={(setupMinutes, invalid, cancelSave) => changeField(op ? { ...value, ops: value.ops.map((entry) => entry.opNo === no ? { ...entry, setupMinutes } : entry) } : { ...value, setupMinutes }, op ? `${no}:setup` : `setup`, invalid, cancelSave)} /></td>
      <td className={cell}><div className="flex items-center gap-1.5"><Stepper label={`${label} 1台`} value={op ? op.minutes : value.perUnitMinutes} ghost={op ? remaining !== null && remaining > 0 ? remaining : null : base} disabled={disabled}
        max={op ? 100000 - (unitOf(value) ?? 0) + (op.minutes ?? 0) : 100000}
        positive={Boolean(op)} invalid={error || Boolean(op && (op.minutes === null || op.minutes <= 0))} draft={!op && value.setupMinutes !== null && value.perUnitMinutes === null}
        onChange={(minutes, invalid, cancelSave) => changeUnit(minutes, op?.opNo, invalid, cancelSave)} />
        {selected && op && <button type="button" aria-label={`${fhincd} ${no}工程を外す`} disabled={disabled} className="h-11 w-10 shrink-0 rounded-lg border-2 border-slate-700 text-xl text-slate-400" onClick={() => remove(op)}>×</button>}</div></td></Fragment>;
    })}
    <td className={`${cell} sticky right-0 z-10 min-w-[240px] ${bg}`}><div className="flex gap-2">
      {hasOps && <button type="button" disabled={disabled || value.ops.length >= 20} className="h-11 w-[104px] rounded-lg border-2 border-dashed border-slate-700 text-slate-400 disabled:opacity-35" onClick={add}>＋工程</button>}
      {selected && touched && <button type="button" disabled={disabled} className="h-11 whitespace-nowrap rounded-lg border-2 border-slate-700 px-3 text-slate-400" onClick={reset}>元に戻す</button>}
    </div></td>
  </tr>;
});
type SheetProps = {
  resourceCd: string; items: GrindingPlanningBoardItem[]; values: GrindingPlanningBoardResourceMinutesResponse['values']; disabled: boolean; unitSplitEnabledByResource?: Readonly<Record<string, boolean>>;
  resourceCds?: readonly string[]; resourceNameMap?: Record<string, string[]>;
};
export function PlanningBoardResourceMinutesSheet({ resourceCds, resourceNameMap, ...props }: SheetProps) {
  return <div data-planning-board-value-sheet role="region" aria-label="品番の値" className="absolute inset-x-0 bottom-0 z-[60] flex flex-col border-t-[3px] border-amber-400 bg-slate-900 shadow-2xl" style={{ height: 'min(56%, 520px)' }}>
    {resourceCds && resourceCds.length > 1 ? <div className="min-h-0 overflow-auto">{resourceCds.map(resourceCd => <div key={resourceCd}>
      <div className="px-4 py-2 font-bold">{resourceCd}{resourceNameMap?.[resourceCd]?.length ? ` ${resourceNameMap[resourceCd]!.join(' / ')}` : ''}</div>
      <ResourceMinutesTable {...props} resourceCd={resourceCd} items={props.items.filter(item => (item.effectiveResourceCd ?? item.originalResourceCd) === resourceCd)} />
    </div>)}</div> : <ResourceMinutesTable {...props} />}
  </div>;
}
function ResourceMinutesTable({ resourceCd, items, values, disabled, unitSplitEnabledByResource }: SheetProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [opOverrides, setOpOverrides] = useState<Record<string, number[] | undefined>>({});
  const select = useCallback((fhincd: string) => setSelected(fhincd), []);
  const onOpsChange = useCallback((fhincd: string, ops: number[] | undefined) => {
    setOpOverrides((previous) => previous[fhincd]?.join(',') === ops?.join(',') ? previous : { ...previous, [fhincd]: ops });
  }, []);
  const groups = useMemo(() => {
    const grouped = new Map<string, GrindingPlanningBoardItem[]>();
    for (const item of items) {
      const fhincd = item.fhincd.trim();
      if (fhincd) {
        const members = grouped.get(fhincd) ?? [];
        members.push(item);
        grouped.set(fhincd, members);
      }
    }
    return grouped;
  }, [items]);
  const used = new Set<number>();
  for (const fhincd of groups.keys()) {
    const nos = opOverrides[fhincd] ?? drafts.get(`${resourceCd}:${fhincd}`)?.ops.map((op) => op.opNo) ?? values.find((value) => value.resourceCd === resourceCd && value.fhincd === fhincd)?.ops?.map((op) => op.opNo) ?? [];
    nos.forEach((no) => used.add(no));
  }
  const hasOps = isPlanningBoardUnitSplitEnabled(resourceCd, unitSplitEnabledByResource) || used.size > 0;
  const columnKey = used.size ? [...used].sort((a, b) => a - b).join(',') : '1';
  const columns = useMemo(() => columnKey.split(',').map(Number), [columnKey]);
  const header = 'sticky top-0 z-20 border-b border-slate-700 bg-slate-950 px-2 py-2 text-[15px] font-normal text-slate-400';
  return <>
    {selected && <div className="px-4 py-2 break-words text-[17px]"><b className="mr-2 font-mono">{selected}</b>{groups.get(selected)?.[0]?.fhinmei}</div>}
    <div className="min-h-0 overflow-auto"><table className="w-max text-left"><thead><tr>
      <th className={`${header} sticky left-0 z-30`}>品番</th><th className={`${header} text-right`}>数</th><th className={`${header} whitespace-nowrap text-right`}>元/台</th><th className={`${header} min-w-[150px] text-right`}>ロット</th>
      {columns.map((no) => <th key={no} colSpan={2} className={header}>{hasOps && <b className="mb-1 block border-b border-slate-700 pb-1 text-base text-sky-300">{no}工程</b>}<div className="grid grid-cols-[184px_220px]"><span>段取り</span><span>1台</span></div></th>)}
      <th className={`${header} sticky right-0 z-30`} aria-label="操作" />
    </tr></thead><tbody>{[...groups].map(([fhincd, members]) => <PartRow key={`${resourceCd}:${fhincd}`} resourceCd={resourceCd} fhincd={fhincd} items={members}
      saved={values.find((value) => value.resourceCd === resourceCd && value.fhincd === fhincd)} disabled={disabled} columns={columns} hasOps={hasOps} selected={selected === fhincd}
      select={select} onOpsChange={onOpsChange} />)}</tbody></table></div>
  </>;
}
