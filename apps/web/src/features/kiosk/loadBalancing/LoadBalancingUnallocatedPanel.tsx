import { formatHours } from './loadBalancingFormat';

import type { ProductionScheduleLoadBalancingStartDateLevelingUnallocatedRow } from '../../../api/client';

const REASON_LABEL: Record<string, string> = {
  missing_planned_start_date: '着手日なし',
  missing_effective_due_date: '納期なし',
  no_active_days: '稼働日なし',
  zero_required_minutes: '工数0'
};

/** 日付や工数が無く、どの月にも載せられなかった行 */
export function LoadBalancingUnallocatedPanel({
  rows,
  onClose
}: {
  rows: ProductionScheduleLoadBalancingStartDateLevelingUnallocatedRow[];
  onClose: () => void;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-[10px] border border-white/15 bg-slate-900/70" data-testid="load-balancing-unallocated">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <h2 className="text-xl font-extrabold">未配分 {rows.length}件</h2>
        <button type="button" className="ml-auto h-10 rounded-lg border border-white/15 px-3.5 font-bold" onClick={onClose}>
          閉じる
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="text-left text-[13px] text-white/55">
              <th className="sticky top-0 bg-slate-900 p-1.5">理由</th>
              <th className="sticky top-0 bg-slate-900 p-1.5">資源</th>
              <th className="sticky top-0 bg-slate-900 p-1.5">製番</th>
              <th className="sticky top-0 bg-slate-900 p-1.5">品番</th>
              <th className="sticky top-0 bg-slate-900 p-1.5 text-right">工数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowId} className="border-t border-white/5">
                <td className="p-1.5 font-bold text-amber-200">{REASON_LABEL[row.reason] ?? row.reason}</td>
                <td className="p-1.5 font-mono">{row.resourceCd}</td>
                <td className="p-1.5 font-mono">{row.fseiban || '—'}</td>
                <td className="p-1.5 font-mono">{row.fhincd || '—'}</td>
                <td className="p-1.5 text-right tabular-nums">{formatHours(row.requiredMinutes)}H</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
