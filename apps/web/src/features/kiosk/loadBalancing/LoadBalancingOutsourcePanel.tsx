import { formatLoadBalancingMachineName, formatHours, formatMonthLabel } from './loadBalancingFormat';
import { aggregateScenario, indexActions, type NoTaker, type ScenarioInput } from './loadBalancingScenario';

import type { ProductionScheduleLoadBalancingWorkspaceRow } from '../../../api/client';

export function LoadBalancingOutsourcePanel({ input, noTaker, onUndo, operationsDisabled = false }: { operationsDisabled?: boolean; input: ScenarioInput; noTaker: NoTaker[]; onUndo: (rowId: string) => void }) {
  noTaker = noTaker.filter((item) => input.rows.some((row) => row.rowId === item.rowId &&
    (!input.machine || formatLoadBalancingMachineName(row.machineName) === formatLoadBalancingMachineName(input.machine))));
  const actions = indexActions(input.actions);
  const { vendorUsage } = aggregateScenario(input);
  const outsourced = input.rows.filter((row) => actions.get(row.rowId)?.type === 'outsource');
  const dueOrder = (a: ProductionScheduleLoadBalancingWorkspaceRow, b: ProductionScheduleLoadBalancingWorkspaceRow) =>
    a.effectiveDueDate.localeCompare(b.effectiveDueDate) || a.rowId.localeCompare(b.rowId);
  const total = (rows: ProductionScheduleLoadBalancingWorkspaceRow[]) => rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-[10px] border border-white/15 bg-slate-900/70" data-testid="load-balancing-outsource">
      <header className="flex items-baseline gap-2 border-b border-white/10 px-4 py-3">
        <h2 className="flex-1 text-xl font-extrabold">外へ出す</h2><b className="text-xl tabular-nums">{formatHours(total(outsourced))}</b><span className="text-white/55">H</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {[...(input.settings?.vendors ?? [])].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map((vendor) => {
          const rows = outsourced.filter((row) => {
            const action = actions.get(row.rowId);
            return action?.type === 'outsource' && action.vendorId === vendor.id;
          }).sort(dueOrder);
          if (!rows.length) return null;
          const usage = vendorUsage.get(vendor.id);
          const months = [...new Set([...input.months, ...usage?.keys() ?? []])].sort();
          return <div key={vendor.id} className="border-b border-white/10 px-3 py-2">
            <div className="mb-1 flex items-center gap-2"><span className="rounded border border-white/15 px-1.5 text-xs text-white/50">{vendor.priority}</span><h3 className="text-lg font-extrabold">{vendor.name}</h3><b className="ml-auto tabular-nums">{formatHours(total(rows))}H</b></div>
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
              {months.map((month) => {
                const used = usage?.get(month) ?? 0, cap = vendor.monthlyCapacityMinutes;
                return <span key={month} className="inline-flex items-center gap-1 text-xs tabular-nums text-white/60">
                  {formatMonthLabel(month)} {formatHours(used)}/{cap === null ? '∞' : formatHours(cap)}H
                  <span className="h-1.5 w-12 overflow-hidden rounded bg-white/10" role="meter" aria-label={`${vendor.name} ${month}`} aria-valuemin={0} aria-valuemax={cap ?? undefined} aria-valuenow={used}>
                    <i className={`block h-full ${cap !== null && used >= cap ? 'bg-amber-400' : 'bg-sky-400'}`} style={{ width: `${cap === null ? 0 : cap > 0 ? Math.min(100, used / cap * 100) : 0}%` }} />
                  </span>
                </span>;
              })}
            </div>
            <table className="w-full text-sm"><tbody>{rows.map((row) => <OutputRow key={row.rowId} row={row} tail={<button type="button" aria-label={`${row.rowId} の外注を取り消す`} className="px-1 text-lg text-white/60 disabled:opacity-30" disabled={operationsDisabled} onClick={() => { if (!operationsDisabled) onUndo(row.rowId); }}>×</button>} />)}</tbody></table>
          </div>;
        })}
        {noTaker.length > 0 ? <div className="px-3 py-2"><div className="flex"><h3 className="flex-1 text-lg font-extrabold text-rose-300">出し先なし</h3><b className="tabular-nums">{formatHours(total(noTaker.flatMap((item) => input.rows.filter((row) => row.rowId === item.rowId))))}H</b></div>
          <table className="w-full text-sm"><tbody>{noTaker.map((item) => {
            const row = input.rows.find((candidate) => candidate.rowId === item.rowId);
            return row && <OutputRow key={row.rowId} row={row} tail={<span className="whitespace-nowrap rounded border border-rose-300/40 px-1 text-xs text-rose-300">{item.reason}</span>} />;
          })}</tbody></table>
        </div> : null}
        {outsourced.length === 0 && noTaker.length === 0 ? <p className="p-6 text-center text-white/40">—</p> : null}
      </div>
    </section>
  );
}

function OutputRow({ row, tail }: { row: ProductionScheduleLoadBalancingWorkspaceRow; tail: React.ReactNode }) {
  return <tr className="border-t border-white/5 [&>td]:px-1 [&>td]:py-1.5">
    <td className="max-w-24 truncate" title={formatLoadBalancingMachineName(row.machineName)}>{formatLoadBalancingMachineName(row.machineName)}</td>
    <td className="font-mono text-xs">{row.fseiban}</td>
    <td className="min-w-0"><div className="max-w-40 truncate" title={row.fhinmei}>{row.fhinmei}</div><small className="block max-w-40 truncate font-mono text-white/45" title={row.fhincd}>{row.fhincd}</small></td>
    <td className="whitespace-nowrap text-right font-bold tabular-nums">{formatHours(row.totalMinutes)}H</td>
    <td className={`whitespace-nowrap tabular-nums ${row.late ? 'text-rose-300' : ''}`}>{row.effectiveDueDate.slice(5).replace('-', '/')}</td>
    <td className="font-mono text-xs text-white/55">{row.resourceCd}</td><td>{tail}</td>
  </tr>;
}
