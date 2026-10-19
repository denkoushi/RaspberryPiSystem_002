import { useState } from 'react';

import { LoadBalancingCapacityEditor } from './LoadBalancingCapacityEditor';
import { LoadBalancingDailyChart } from './LoadBalancingDailyChart';
import { formatHours, formatLoadBalancingMachineName, formatYearMonthSlash } from './loadBalancingFormat';
import { LoadBalancingActionIcon } from './LoadBalancingIcons';
import { LATE_BUCKET, type ScenarioAction, type TransferDestination, listCellRows } from './loadBalancingScenario';

import type {
  ProductionScheduleLoadBalancingWorkspaceDayResponse,
  ProductionScheduleLoadBalancingWorkspaceResource
} from '../../../api/client';

type CellRow = ReturnType<typeof listCellRows>[number];

type Props = {
  resource: ProductionScheduleLoadBalancingWorkspaceResource;
  displayName: string;
  bucket: string;
  loadMinutes: number;
  capacityMinutes: number | null;
  cellRows: CellRow[];
  canTransfer: boolean;
  day: ProductionScheduleLoadBalancingWorkspaceDayResponse | undefined;
  dayLoading: boolean;
  /** 日別グラフから差し引く行（外注・移管・後ろへ済み） */
  removedRowIds: Set<string>;
  editingCapacity: boolean;
  capacitySaving: boolean;
  capacityError: string | null;
  onEditCapacity: () => void;
  onSaveCapacity: (minutes: number) => void;
  onCancelCapacity: () => void;
  onAutoLevel: () => void;
  onAction: (action: ScenarioAction) => void;
  onUndo: (rowId: string) => void;
  listDestinations: (rowMinutes: number) => TransferDestination[];
  resolveName: (resourceCd: string) => string;
};

export function LoadBalancingCellDetail(props: Props) {
  const { resource, bucket, loadMinutes, capacityMinutes } = props;
  const [transferRowId, setTransferRowId] = useState<string | null>(null);
  const over = capacityMinutes == null ? null : loadMinutes - capacityMinutes;
  const isLate = bucket === LATE_BUCKET;

  const dailyDays =
    props.day && !isLate
      ? props.day.days.map((day) => ({
          date: day.date,
          requiredMinutes:
            day.requiredMinutes -
            props.day!.rowDays
              .filter((item) => item.date === day.date && props.removedRowIds.has(item.rowId))
              .reduce((sum, item) => sum + item.minutes, 0)
        }))
      : [];

  return (
    <section className="flex min-h-0 flex-col rounded-[10px] border border-white/15 bg-slate-900/70" data-testid="load-balancing-cell-detail">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/10 px-4 py-2.5">
        <h2 className="text-xl font-extrabold">
          <span className="font-mono">{resource.resourceCd}</span> {props.displayName}
          <span className="ml-2 font-bold text-white/60">{formatYearMonthSlash(bucket)}</span>
        </h2>
        <Figure label="必要" value={`${formatHours(loadMinutes)}H`} />
        {props.editingCapacity ? (
          <LoadBalancingCapacityEditor
            resourceCd={resource.resourceCd}
            currentMinutes={resource.baseCapacityMinutes}
            saving={props.capacitySaving}
            error={props.capacityError}
            onSave={props.onSaveCapacity}
            onCancel={props.onCancelCapacity}
          />
        ) : isLate ? null : (
          <button
            type="button"
            className="rounded-lg px-1 text-left hover:bg-slate-800"
            aria-label={`${resource.resourceCd} の能力を編集`}
            onClick={props.onEditCapacity}
          >
            <Figure
              label="能力 ✎"
              value={capacityMinutes == null ? '未設定' : `${formatHours(capacityMinutes)}H`}
              tone={capacityMinutes == null ? 'warn' : undefined}
            />
          </button>
        )}
        {over != null && !props.editingCapacity ? (
          <Figure
            label={over > 0 ? '超過' : '余力'}
            value={`${over > 0 ? '+' : ''}${formatHours(Math.abs(over))}H`}
            tone={over > 0 ? 'bad' : 'good'}
          />
        ) : null}
        <button
          type="button"
          className="ml-auto h-10 rounded-lg bg-emerald-600 px-4 font-bold text-white disabled:opacity-35"
          disabled={over == null || over < 30}
          onClick={props.onAutoLevel}
        >
          ⚡ 超過分を自動で崩す
        </button>
      </header>

      {!isLate ? (
        <div className="border-b border-white/10 px-3 pt-2">
          {props.dayLoading && dailyDays.length === 0 ? (
            <div className="h-[170px] animate-pulse rounded bg-white/5" />
          ) : (
            <LoadBalancingDailyChart days={dailyDays} capacityMinutesPerDay={props.day?.capacityMinutesPerDay ?? null} />
          )}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="text-left text-[13px] text-white/55">
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 font-bold">機種</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 font-bold">製番</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 font-bold">部品</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 text-right font-bold">工数</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 font-bold">期間</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 text-right font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {props.cellRows.map((item) => (
              <tr
                key={item.row.rowId}
                className={`border-t border-white/5 ${item.action && !item.movedIn ? '[&>td:not(:last-child)]:opacity-45' : ''}`}
              >
                <td className="p-1.5">
                  <span className="inline-block max-w-[11rem] truncate rounded-md bg-slate-800 px-2 py-0.5 align-middle text-[13px] font-bold">
                    {formatLoadBalancingMachineName(item.row.machineName)}
                  </span>
                </td>
                <td className="p-1.5 font-mono text-sm">{item.row.fseiban}</td>
                <td className="p-1.5">
                  <div className="font-bold">{item.row.fhinmei || '—'}</div>
                  <div className="font-mono text-xs text-white/55">{item.row.fhincd}</div>
                </td>
                <td className="p-1.5 text-right font-extrabold tabular-nums">
                  {formatHours(item.movedIn ? item.placedMinutes : item.originalMinutes)}
                  <span className="text-xs font-normal text-white/55"> H</span>
                </td>
                <td className="p-1.5">
                  <Period start={item.row.plannedStartDate} due={item.row.effectiveDueDate} bucket={bucket} late={item.row.late} />
                </td>
                <td className="relative p-1.5 text-right">
                  {item.movedIn ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-950 px-2.5 py-1 text-sm font-extrabold text-sky-200">
                      <LoadBalancingActionIcon type="transfer" />
                      {item.row.resourceCd}から
                    </span>
                  ) : item.action ? (
                    <ActionTag action={item.action} onUndo={() => props.onUndo(item.row.rowId)} />
                  ) : (
                    <div className="flex justify-end gap-1.5">
                      <ActionButton type="outsource" onClick={() => props.onAction({ rowId: item.row.rowId, type: 'outsource' })} />
                      {props.canTransfer ? (
                        <ActionButton
                          type="transfer"
                          onClick={() => setTransferRowId(transferRowId === item.row.rowId ? null : item.row.rowId)}
                        />
                      ) : null}
                      <ActionButton
                        type="defer"
                        onClick={() => props.onAction({ rowId: item.row.rowId, type: 'defer', fromBucket: bucket })}
                      />
                    </div>
                  )}
                  {transferRowId === item.row.rowId ? (
                    <TransferMenu
                      destinations={props.listDestinations(item.originalMinutes)}
                      resolveName={props.resolveName}
                      onPick={(destination) => {
                        setTransferRowId(null);
                        props.onAction({
                          rowId: item.row.rowId,
                          type: 'transfer',
                          toResourceCd: destination.resourceCd,
                          efficiencyRatio: destination.efficiencyRatio
                        });
                      }}
                      onClose={() => setTransferRowId(null)}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {props.cellRows.length === 0 ? <p className="p-4 text-white/50">この月の負荷はありません</p> : null}
      </div>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'good' | 'warn' }) {
  const color =
    tone === 'bad' ? 'text-rose-400' : tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-200' : '';
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-xs font-bold text-white/55">{label}</span>
      <span className={`text-[22px] font-extrabold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

const ACTION_LABEL = { outsource: '外注', transfer: '移管', defer: '後ろへ' } as const;
const ACTION_HOVER = {
  outsource: 'hover:bg-amber-900',
  transfer: 'hover:bg-sky-900',
  defer: 'hover:bg-fuchsia-900'
} as const;
const ACTION_TAG = {
  outsource: 'bg-amber-950 text-amber-200',
  transfer: 'bg-sky-950 text-sky-200',
  defer: 'bg-fuchsia-950 text-fuchsia-200'
} as const;

function ActionButton({ type, onClick }: { type: ScenarioAction['type']; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center gap-1 rounded-lg bg-slate-800 px-2.5 text-sm font-extrabold ${ACTION_HOVER[type]}`}
      onClick={onClick}
    >
      <LoadBalancingActionIcon type={type} />
      {ACTION_LABEL[type]}
    </button>
  );
}

function ActionTag({ action, onUndo }: { action: ScenarioAction; onUndo: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-extrabold ${ACTION_TAG[action.type]}`}>
      <LoadBalancingActionIcon type={action.type} />
      {action.type === 'transfer' ? `→ ${action.toResourceCd}` : ACTION_LABEL[action.type]}
      <button type="button" className="ml-1 opacity-70 hover:opacity-100" aria-label="取り消す" onClick={onUndo}>
        ×
      </button>
    </span>
  );
}

function TransferMenu({
  destinations,
  resolveName,
  onPick,
  onClose
}: {
  destinations: TransferDestination[];
  resolveName: (resourceCd: string) => string;
  onPick: (destination: TransferDestination) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute right-1.5 top-[calc(100%-4px)] z-10 w-80 rounded-[10px] border border-white/15 bg-slate-950 p-1.5 text-left shadow-2xl"
      role="menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      {destinations.length === 0 ? (
        <p className="p-2 text-sm text-white/55">移管先がありません</p>
      ) : (
        destinations.map((destination) => (
          <button
            key={destination.resourceCd}
            type="button"
            role="menuitem"
            className={`flex h-10 w-full items-center justify-between rounded-lg px-2.5 font-bold hover:bg-slate-800 ${
              destination.fits ? '' : 'opacity-60'
            }`}
            onClick={() => onPick(destination)}
          >
            <span className="truncate">
              <span className="font-mono">{destination.resourceCd}</span>
              <span className="ml-2 text-sm text-white/65">{resolveName(destination.resourceCd)}</span>
            </span>
            <span className={`shrink-0 tabular-nums ${destination.fits ? 'text-emerald-300' : 'text-rose-400'}`}>
              余力 {formatHours(destination.spareMinutes)}H
            </span>
          </button>
        ))
      )}
    </div>
  );
}

/** 着手〜納期のうち、表示中の月にかかる範囲を帯で示す */
function Period({ start, due, bucket, late }: { start: string; due: string; bucket: string; late: boolean }) {
  if (late || bucket === LATE_BUCKET) {
    return (
      <span className="whitespace-nowrap rounded-md bg-[#2a1320] px-2 py-0.5 text-sm font-bold text-rose-300">
        納期 {Number(due.slice(5, 7))}/{Number(due.slice(8, 10))}
      </span>
    );
  }
  const daysInMonth = new Date(Number(bucket.slice(0, 4)), Number(bucket.slice(5, 7)), 0).getDate();
  const monthStart = `${bucket}-01`;
  const monthEnd = `${bucket}-${String(daysInMonth).padStart(2, '0')}`;
  const from = start < monthStart ? 1 : Number(start.slice(8, 10));
  const to = due > monthEnd ? daysInMonth : Number(due.slice(8, 10));
  return (
    <div
      className="relative h-3.5 w-[150px] rounded bg-slate-800"
      title={`${start} 〜 ${due}`}
      aria-label={`着手 ${start} 納期 ${due}`}
    >
      <i
        className="absolute inset-y-0 rounded bg-sky-400/85"
        style={{ left: `${((from - 1) / daysInMonth) * 100}%`, width: `${Math.max(4, ((to - from + 1) / daysInMonth) * 100)}%` }}
      />
    </div>
  );
}
