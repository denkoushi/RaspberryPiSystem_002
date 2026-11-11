import { useState } from 'react';

import { LoadBalancingCapacityEditor } from './LoadBalancingCapacityEditor';
import { formatHours, formatYearMonthSlash } from './loadBalancingFormat';
import { LoadBalancingActionIcon } from './LoadBalancingIcons';
import { LATE_BUCKET, type ScenarioAction, type TransferDestination, listCellRows } from './loadBalancingScenario';

import type {
  ProductionScheduleLoadBalancingWorkspaceResource,
  ProductionScheduleLoadBalancingWorkspaceRow,
  OutsourceVendor
} from '../../../api/client';

type CellRow = ReturnType<typeof listCellRows>[number];

type Props = {
  resource: ProductionScheduleLoadBalancingWorkspaceResource;
  displayName: string;
  bucket: string;
  loadMinutes: number;
  capacityMinutes: number | null;
  cellRows: CellRow[];
  formattedMachineNames: Map<string, string>;
  operationsDisabled?: boolean;
  canTransfer: boolean;
  editingCapacity: boolean;
  capacitySaving: boolean;
  capacityError: string | null;
  onEditCapacity: () => void;
  onSaveCapacity: (minutes: number) => void;
  onCancelCapacity: () => void;
  onAction: (action: ScenarioAction) => void;
  onUndo: (rowId: string) => void;
  listDestinations: (row: ProductionScheduleLoadBalancingWorkspaceRow) => TransferDestination[];
  vendors: OutsourceVendor[];
  listVendors: (row: ProductionScheduleLoadBalancingWorkspaceRow) => Array<{ vendor: OutsourceVendor; matches: boolean; fits: boolean }>;
  resolveName: (resourceCd: string) => string;
};

export function LoadBalancingCellDetail(props: Props) {
  const { resource, bucket, loadMinutes, capacityMinutes } = props;
  const [outsourceRowId, setOutsourceRowId] = useState<string | null>(null);
  const [transferRowId, setTransferRowId] = useState<string | null>(null);
  const over = capacityMinutes == null ? null : loadMinutes - capacityMinutes;
  const isLate = bucket === LATE_BUCKET;

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
            disabled={props.operationsDisabled}
            error={props.capacityError}
            onSave={props.onSaveCapacity}
            onCancel={props.onCancelCapacity}
          />
        ) : isLate ? null : (
          <button
            type="button"
            className="rounded-lg px-1 text-left hover:bg-slate-800 disabled:opacity-30"
            disabled={props.operationsDisabled}
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
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="text-left text-[13px] text-white/55">
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 font-bold">機種</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 font-bold">製番</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 font-bold">部品</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 text-right font-bold">工数</th>
              <th className="sticky top-0 z-[1] bg-slate-900 p-1.5 font-bold">納期</th>
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
                    {props.formattedMachineNames.get(item.row.machineName)}
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
                  <span className={item.row.late ? 'text-rose-300' : 'tabular-nums'}>{item.row.effectiveDueDate.slice(5).replace('-', '/')}</span>
                </td>
                <td className="relative p-1.5 text-right">
                  {item.movedIn ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-950 px-2.5 py-1 text-sm font-extrabold text-sky-200">
                      <LoadBalancingActionIcon type="transfer" />
                      {item.row.resourceCd}から
                    </span>
                  ) : item.action ? (
                    <ActionTag disabled={props.operationsDisabled} action={item.action} vendorName={item.action.type === 'outsource' ? props.vendors.find((vendor) => item.action?.type === 'outsource' && vendor.id === item.action.vendorId)?.name : undefined} onUndo={() => props.onUndo(item.row.rowId)} />
                  ) : (
                    <div className="flex justify-end gap-1.5">
                      <ActionButton disabled={props.operationsDisabled} type="outsource" onClick={() => { setTransferRowId(null); setOutsourceRowId(outsourceRowId === item.row.rowId ? null : item.row.rowId); }} />
                      {props.canTransfer ? (
                        <ActionButton
                          disabled={props.operationsDisabled}
                          type="transfer"
                          onClick={() => { setOutsourceRowId(null); setTransferRowId(transferRowId === item.row.rowId ? null : item.row.rowId); }}
                        />
                      ) : null}
                      <ActionButton
                        disabled={props.operationsDisabled}
                        type="defer"
                        onClick={() => props.onAction({ rowId: item.row.rowId, type: 'defer', fromBucket: bucket })}
                      />
                    </div>
                  )}
                  {outsourceRowId === item.row.rowId ? (
                    <div className="absolute right-1 top-full z-10 min-w-60 rounded-lg border border-white/15 bg-slate-950 p-2 shadow-xl" onKeyDown={(event) => { if (event.key === 'Escape') setOutsourceRowId(null); }}>
                      {props.listVendors(item.row).map((option) => <button type="button" key={option.vendor.id} disabled={props.operationsDisabled || !option.fits} className="flex w-full items-center justify-between gap-4 rounded p-3 text-left font-bold hover:bg-slate-800 disabled:opacity-30" onClick={() => {
                        if (props.operationsDisabled) return;
                        setOutsourceRowId(null);
                        props.onAction({ rowId: item.row.rowId, type: 'outsource', vendorId: option.vendor.id });
                      }}>{option.vendor.name}<small className="text-white/55">{!option.matches ? '条件' : !option.fits ? '上限' : ''}</small></button>)}
                      {props.vendors.length === 0 ? <span className="block p-2 text-white/40">—</span> : null}
                    </div>
                  ) : null}
                  {transferRowId === item.row.rowId ? (
                    <TransferMenu
                      disabled={props.operationsDisabled}
                      destinations={props.listDestinations(item.row)}
                      resolveName={props.resolveName}
                      onPick={(destination) => {
                        if (props.operationsDisabled) return;
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

function ActionButton({ type, onClick, disabled }: { type: ScenarioAction['type']; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center gap-1 rounded-lg bg-slate-800 px-2.5 text-sm font-extrabold disabled:opacity-30 ${ACTION_HOVER[type]}`}
      disabled={disabled}
      onClick={() => { if (!disabled) onClick(); }}
    >
      <LoadBalancingActionIcon type={type} />
      {ACTION_LABEL[type]}{type === 'defer' ? '' : ' ▾'}
    </button>
  );
}

function ActionTag({ action, vendorName, onUndo, disabled }: { action: ScenarioAction; vendorName?: string; onUndo: () => void; disabled?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-extrabold ${ACTION_TAG[action.type]}`}>
      <LoadBalancingActionIcon type={action.type} />
      {action.type === 'transfer' ? `→ ${action.toResourceCd}` : action.type === 'outsource' ? `外注 ${vendorName ?? ''}` : ACTION_LABEL[action.type]}
      <button type="button" className="ml-1 opacity-70 hover:opacity-100 disabled:opacity-30" aria-label="取り消す" disabled={disabled} onClick={() => { if (!disabled) onUndo(); }}>
        ×
      </button>
    </span>
  );
}

function TransferMenu({
  destinations,
  disabled,
  resolveName,
  onPick,
  onClose
}: {
  destinations: TransferDestination[];
  disabled?: boolean;
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
              disabled ? 'opacity-30' : destination.fits ? '' : 'opacity-60'
            }`}
            disabled={disabled || !destination.fits}
            onClick={() => { if (!disabled) onPick(destination); }}
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
