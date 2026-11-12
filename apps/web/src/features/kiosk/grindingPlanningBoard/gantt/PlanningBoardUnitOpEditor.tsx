import { isAxiosError } from 'axios';
import { createContext, useContext, useState } from 'react';

import { useConfigureKioskSessakuPieceOps } from '../../../../api/hooks/production-schedule/grinding-planning-board';
import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';
import { usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';

import { PlanningBoardMinutesStepper } from './PlanningBoardResourceMinutesSheet';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceMinutesResponse, SessakuPieceOpsConfigureRequest, SessakuPieceOpsClearRequest } from '@raspi-system/shared-types';

export const PlanningBoardUnitOpContext = createContext<{
  minutes?: GrindingPlanningBoardResourceMinutesResponse;
  items: readonly GrindingPlanningBoardItem[];
  loading: boolean;
} | null>(null);

const half = (value: number) => Math.round(value * 2) / 2;
export function unitOpDraft(total: number, count: number, registered: readonly { minutes: number }[]) {
  return registered.length === count ? registered.map((op) => op.minutes) : Array.from({ length: count }, () => half(total / count));
}
export function unitOpGhost(original: number, values: readonly (number | null)[]) {
  const empty = values.filter((value) => value === null).length;
  const remainder = original - values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return empty && Number.isFinite(remainder) && remainder > 0 ? half(remainder / empty) : null;
}

export function PlanningBoardUnitOpEditor({ item, canConfigure, disabled, onClose, onPending, onFailure }: {
  item: GrindingPlanningBoardItem; canConfigure: boolean; disabled: boolean; onClose: () => void;
  onPending: (pending: boolean) => void; onFailure: (failure: { message: string; isError: boolean } | null) => void;
}) {
  const context = useContext(PlanningBoardUnitOpContext) ?? { items: [item], loading: false };
  const { dueSource } = useContext(DScheduleMinutesContext);
  const mutation = useConfigureKioskSessakuPieceOps(dueSource);
  const offline = usePlanningBoardOffline();
  const { gate } = offline;
  // Freeze the definition snapshot until the dialog closes: concurrent edits must conflict.
  const [saved] = useState(() => context.minutes?.values.find((value) => value.resourceCd === item.effectiveResourceCd && value.fhincd === item.fhincd.trim()));
  const [registered] = useState(() => [...(saved?.ops ?? [])].sort((a, b) => a.opNo - b.opNo));
  const siblings = context.items.filter((candidate) => candidate.pieceId === item.pieceId);
  const [original] = useState(() => item.opRange
    ? siblings.reduce((sum, candidate) => sum + (candidate.unitRequiredMinutes ?? 0), 0)
    : item.unitRequiredMinutes ?? Math.max(0, (item.requiredMinutes ?? 0) - (item.setupMinutes ?? 0)));
  const total = registered.length ? registered.reduce((sum, op) => sum + op.minutes, 0) : original;
  const [values, setValues] = useState<(number | null)[]>(() => unitOpDraft(total, registered.length || 2, registered));
  const [invalid, setInvalid] = useState<number[]>([]);
  const ghost = unitOpGhost(original, values);
  const resolved = values.map((value) => value ?? ghost);
  const valid = !invalid.length && resolved.every((value) => value !== null && Number.isFinite(value) && value > 0 && Number.isInteger(value * 2)) &&
    resolved.reduce<number>((sum, value) => sum + (value ?? 0), 0) <= 100000;
  const hasSplits = Boolean(item.opRange) || context.items.some((candidate) => candidate.parentItemId === item.parentItemId && candidate.opRange);
  const run = async (scope?: 'piece' | 'set') => {
    if (disabled || mutation.isPending || !gate.attempt()) return;
    if (!scope && (!valid || !item.effectiveResourceCd)) return;
    const generation = gate.generation();
    onPending(true); onFailure(null);
    try {
      const common = { itemId: item.itemId, itemRevision: item.itemRevision, expectedPieceSetVersion: item.pieceSetVersion! };
      const payload: SessakuPieceOpsConfigureRequest | SessakuPieceOpsClearRequest = scope ? { ...common, scope } : {
        ...common, resourceCd: item.effectiveResourceCd!, minutes: resolved as number[],
        expectedOpIds: registered.flatMap((op) => op.id ? [op.id] : []),
        expectedMinutes: saved ? { perUnitMinutes: saved.perUnitMinutes, setupMinutes: saved.setupMinutes,
          ops: registered.map((op) => ({ opNo: op.opNo, minutes: op.minutes, setupMinutes: op.setupMinutes ?? null })) } : null
      };
      await gate.run(() => mutation.mutateAsync(payload));
      if (generation !== gate.generation()) return;
      if (offline.enabled) await Promise.all(['board', 'load', 'resource-minutes'].map((key) => offline.refreshRead(key)));
      if (generation === gate.generation()) onClose();
    } catch (error) {
      if (generation === gate.generation()) onFailure({ message: isAxiosError(error) && error.response?.data?.errorCode === 'OPERATION_SPLIT_IN_USE'
        ? '別のロットや対象外の台が工程で分かれています。先にまとめてください' : error instanceof Error ? error.message : '保存できませんでした。', isError: true });
    } finally { if (generation === gate.generation()) onPending(false); }
  };
  return <>
    {canConfigure && <>
      <div role="group" aria-label="工程の数" className="grid grid-cols-6 gap-1">
        {[1, 2, 3, 4, 5, 6].map((count) => <button type="button" key={count} aria-label={`${count}工程`} aria-pressed={values.length === count}
          disabled={disabled} onClick={() => { if (!gate.attempt()) return; setValues(unitOpDraft(total, count, registered)); setInvalid([]); }}
          className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-2 rounded border-2 tabular-nums disabled:opacity-40 ${values.length === count ? 'border-emerald-400 text-emerald-400' : 'border-slate-600'}`}>
          <span aria-hidden="true" className="flex h-2 w-[30px] gap-0.5">{Array.from({ length: count }, (_, index) => <span key={index} className="min-w-0 flex-1 bg-current" />)}</span>{count}
        </button>)}
      </div>
      {values.map((value, index) => <div className="flex items-center gap-2" key={index}>
        <b className="w-11 shrink-0 whitespace-nowrap text-[15px] text-sky-300">{index + 1}工程</b>
        <PlanningBoardMinutesStepper label={`${index + 1}工程 1台`} value={value} ghost={ghost} disabled={disabled} positive
          invalid={invalid.includes(index) || (value === null ? ghost === null || ghost <= 0 : value <= 0)}
          onChange={(next, bad) => {
            setValues((previous) => previous.map((current, i) => i === index ? next : current));
            setInvalid((previous) => [...previous.filter((i) => i !== index), ...(bad || (next !== null && !Number.isInteger(next * 2)) ? [index] : [])]);
          }} />
      </div>)}
      <button type="button" disabled={disabled || !valid || values.length > 6 || !item.effectiveResourceCd} className="min-h-11 rounded border border-emerald-400 disabled:opacity-40" onClick={() => void run()}>{values.length}工程にする</button>
    </>}
    {item.opRange && <button type="button" disabled={disabled} className="min-h-11 rounded border border-emerald-400 disabled:opacity-40" onClick={() => void run('piece')}>まとめる</button>}
    {hasSplits && <button type="button" disabled={disabled} className="min-h-11 rounded border border-emerald-400 disabled:opacity-40" onClick={() => void run('set')}>全部まとめる</button>}
  </>;
}
