import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { useKioskProductionScheduleLoadBalancingMachineMonthlyLoad } from '../../../api/hooks';

import { defaultMachineMonthlyRange, isValidYearMonth } from './loadBalancingMonthRange';
import { mapMachineMonthlyLoadChartRows } from './mapMachineMonthlyLoadChartRows';

const STACK_COLORS = [
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#f97316',
  '#60a5fa',
  '#4ade80',
  '#e879f9',
  '#22d3ee'
];

type ScopeParams = { targetDeviceScopeKey?: string };

type Props = {
  scopeParams: ScopeParams;
  scopeEnabled: boolean;
};

export function LoadBalancingMachineMonthlyTab({ scopeParams, scopeEnabled }: Props) {
  const initialRange = useMemo(() => defaultMachineMonthlyRange(), []);
  const [fromMonth, setFromMonth] = useState(initialRange.fromMonth);
  const [toMonth, setToMonth] = useState(initialRange.toMonth);
  const [selectedMachineName, setSelectedMachineName] = useState('');
  const [selectedFhincd, setSelectedFhincd] = useState('');

  const queryEnabled =
    scopeEnabled && isValidYearMonth(fromMonth) && isValidYearMonth(toMonth) && fromMonth <= toMonth;

  const queryParams = useMemo(
    () => ({
      fromMonth: fromMonth.trim(),
      toMonth: toMonth.trim(),
      ...scopeParams,
      machineName: selectedMachineName.trim().length > 0 ? selectedMachineName.trim() : undefined,
      fhincd: selectedFhincd.trim().length > 0 ? selectedFhincd.trim() : undefined
    }),
    [fromMonth, toMonth, scopeParams, selectedMachineName, selectedFhincd]
  );

  const loadQuery = useKioskProductionScheduleLoadBalancingMachineMonthlyLoad(queryParams, {
    enabled: queryEnabled
  });

  useEffect(() => {
    setSelectedFhincd('');
  }, [selectedMachineName, fromMonth, toMonth]);

  const { chartRows, resourceCds } = useMemo(() => {
    if (!loadQuery.data) {
      return { chartRows: [], resourceCds: [] as string[] };
    }
    return mapMachineMonthlyLoadChartRows({
      months: loadQuery.data.months,
      resourceMonths: loadQuery.data.resourceMonths
    });
  }, [loadQuery.data]);

  return (
    <>
      <p className="max-w-3xl text-xs text-white/70">
        機種（製番の MH/SH 行 <code className="text-white/90">FHINMEI</code>）を選び、未完了部品工程の{' '}
        <strong className="font-semibold text-white">有効納期</strong>（行備考 → なければ plannedEndDate）の月で資源CD別所要量を表示します。山崩しタブの単月集計（計画完了月）とは月の定義が異なります。
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-white/90">
          開始月
          <input
            type="month"
            value={fromMonth}
            onChange={(event) => setFromMonth(event.target.value)}
            className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-white/90">
          終了月
          <input
            type="month"
            value={toMonth}
            onChange={(event) => setToMonth(event.target.value)}
            className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
          />
        </label>
        <label className="flex min-w-[12rem] flex-col gap-1 text-xs font-semibold text-white/90">
          機種（FHINMEI）
          <select
            value={selectedMachineName}
            onChange={(event) => setSelectedMachineName(event.target.value)}
            className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
            disabled={!loadQuery.data?.machines.length}
          >
            <option value="">— 選択 —</option>
            {(loadQuery.data?.machines ?? []).map((machine) => (
              <option key={machine.machineName} value={machine.machineName}>
                {machine.machineName}（{Math.round(machine.requiredMinutes)}分 / 製番{machine.fseibanCount}）
              </option>
            ))}
          </select>
        </label>
        {selectedFhincd ? (
          <button
            type="button"
            className="rounded-md border border-white/30 px-2 py-1 text-[11px] text-white/80"
            onClick={() => setSelectedFhincd('')}
          >
            部品絞り込み解除 ({selectedFhincd})
          </button>
        ) : null}
      </div>

      {loadQuery.error ? (
        <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-950/40 p-2 text-xs text-rose-100">
          読み込みエラー: {loadQuery.error instanceof Error ? loadQuery.error.message : String(loadQuery.error)}
        </div>
      ) : null}

      {loadQuery.isFetching ? <p className="mt-2 text-xs text-white/70">集計を読み込み中…</p> : null}

      {loadQuery.data ? (
        <p className="mt-2 text-[11px] text-white/60">
          siteKey: <span className="font-mono text-white/90">{loadQuery.data.siteKey}</span> /{' '}
          <span className="font-mono text-white/90">
            {loadQuery.data.fromMonth}〜{loadQuery.data.toMonth}
          </span>
          （有効納期月）
        </p>
      ) : null}

      <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/50 p-2">
        <p className="mb-2 text-xs font-semibold text-white">月別・資源CD別（積み上げ・上位24資源）</p>
        {!selectedMachineName ? (
          <p className="text-xs text-white/60">機種を選択するとグラフを表示します。</p>
        ) : chartRows.length === 0 || resourceCds.length === 0 ? (
          <p className="text-xs text-white/60">表示できるデータがありません。</p>
        ) : (
          <div className="h-[300px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" tick={{ fill: '#e2e8f0', fontSize: 10 }} />
                <YAxis tick={{ fill: '#e2e8f0', fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10, color: '#e2e8f0' }} />
                {resourceCds.map((cd, index) => (
                  <Bar
                    key={cd}
                    dataKey={cd}
                    name={cd}
                    stackId="load"
                    fill={STACK_COLORS[index % STACK_COLORS.length]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <p className="mb-2 text-xs font-semibold text-white">部品一覧（選択機種）</p>
        {!selectedMachineName ? (
          <p className="text-xs text-white/60">機種を選択してください。</p>
        ) : (
          <div className="max-h-56 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">品番</th>
                  <th className="px-2 py-1">品名</th>
                  <th className="px-2 py-1">最早納期</th>
                  <th className="px-2 py-1">所要分</th>
                  <th className="px-2 py-1">資源</th>
                </tr>
              </thead>
              <tbody>
                {(loadQuery.data?.parts ?? []).map((part) => {
                  const active = selectedFhincd === part.fhincd;
                  return (
                    <tr
                      key={part.fhincd}
                      className={`cursor-pointer border-b border-white/5 ${active ? 'bg-fuchsia-900/40' : ''}`}
                      onClick={() => setSelectedFhincd(part.fhincd)}
                    >
                      <td className="px-2 py-1 font-mono">{part.fhincd}</td>
                      <td className="px-2 py-1">{part.fhinmei || '—'}</td>
                      <td className="px-2 py-1 font-mono">{part.effectiveDueDateMin ?? '—'}</td>
                      <td className="px-2 py-1">{Math.round(part.totalRequiredMinutes)}</td>
                      <td className="px-2 py-1 font-mono text-[10px]">{part.resourceCds.join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <p className="mb-2 text-xs font-semibold text-white">明細（月×資源CD）</p>
        {!selectedMachineName ? (
          <p className="text-xs text-white/60">機種を選択してください。</p>
        ) : (
          <div className="max-h-72 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">月</th>
                  <th className="px-2 py-1">資源CD</th>
                  <th className="px-2 py-1">必要分</th>
                </tr>
              </thead>
              <tbody>
                {(loadQuery.data?.resourceMonths ?? []).map((cell) => (
                  <tr key={`${cell.month}-${cell.resourceCd}`} className="border-b border-white/5">
                    <td className="px-2 py-1 font-mono">{cell.month}</td>
                    <td className="px-2 py-1 font-mono">{cell.resourceCd}</td>
                    <td className="px-2 py-1">{Math.round(cell.requiredMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedMachineName && (loadQuery.data?.partRows.length ?? 0) > 0 ? (
        <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
          <p className="mb-2 text-xs font-semibold text-white">工程行（{selectedFhincd ? `品番 ${selectedFhincd}` : '全件'}）</p>
          <div className="max-h-64 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">納期</th>
                  <th className="px-2 py-1">製番</th>
                  <th className="px-2 py-1">品番</th>
                  <th className="px-2 py-1">資源</th>
                  <th className="px-2 py-1">工順</th>
                  <th className="px-2 py-1">分</th>
                  <th className="px-2 py-1">納期元</th>
                </tr>
              </thead>
              <tbody>
                {(loadQuery.data?.partRows ?? []).map((row) => (
                  <tr key={row.rowId} className="border-b border-white/5">
                    <td className="px-2 py-1 font-mono">{row.effectiveDueDate}</td>
                    <td className="px-2 py-1 font-mono">{row.fseiban}</td>
                    <td className="px-2 py-1 font-mono">{row.fhincd}</td>
                    <td className="px-2 py-1 font-mono">{row.resourceCd}</td>
                    <td className="px-2 py-1">{row.fkojun ?? '—'}</td>
                    <td className="px-2 py-1">{Math.round(row.requiredMinutes)}</td>
                    <td className="px-2 py-1">{row.effectiveDueDateSource === 'manual' ? '備考' : 'CSV'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
