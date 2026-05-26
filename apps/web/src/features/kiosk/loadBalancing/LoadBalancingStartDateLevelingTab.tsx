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

import {
  useKioskProductionScheduleLoadBalancingStartDateLeveling,
  usePostKioskProductionScheduleLoadBalancingStartDateLevelingSimulate
} from '../../../api/hooks';

import { defaultMachineMonthlyRange, isValidYearMonth } from './loadBalancingMonthRange';
import {
  mapStartDateLevelingChartRows,
  mapStartDateLevelingDayCompareRows
} from './mapStartDateLevelingChartRows';

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

const UNALLOCATED_LABELS: Record<string, string> = {
  missing_planned_start_date: '着手日なし',
  missing_effective_due_date: '有効納期なし',
  invalid_quantity: '指示数不明',
  no_active_days: '稼働日なし',
  zero_required_minutes: '所要0分'
};

type ScopeParams = { targetDeviceScopeKey?: string };

type Props = {
  scopeParams: ScopeParams;
  scopeEnabled: boolean;
};

type BucketView = 'month' | 'day';

export function LoadBalancingStartDateLevelingTab({ scopeParams, scopeEnabled }: Props) {
  const initialRange = useMemo(() => defaultMachineMonthlyRange(), []);
  const [fromMonth, setFromMonth] = useState(initialRange.fromMonth);
  const [toMonth, setToMonth] = useState(initialRange.toMonth);
  const [bucket, setBucket] = useState<BucketView>('month');
  const [focusMonth, setFocusMonth] = useState(initialRange.fromMonth);
  const [resourceCd, setResourceCd] = useState('');
  const [simTargetDate, setSimTargetDate] = useState('');
  const [selectedRowId, setSelectedRowId] = useState('');
  const [simResult, setSimResult] = useState<ReturnType<
    typeof usePostKioskProductionScheduleLoadBalancingStartDateLevelingSimulate
  >['data'] | null>(null);

  const queryEnabled =
    scopeEnabled && isValidYearMonth(fromMonth) && isValidYearMonth(toMonth) && fromMonth <= toMonth;

  const queryParams = useMemo(
    () => ({
      fromMonth: fromMonth.trim(),
      toMonth: toMonth.trim(),
      bucket,
      focusMonth: bucket === 'day' ? focusMonth.trim() : undefined,
      ...scopeParams,
      resourceCd: resourceCd.trim().length > 0 ? resourceCd.trim() : undefined
    }),
    [fromMonth, toMonth, bucket, focusMonth, scopeParams, resourceCd]
  );

  const loadQuery = useKioskProductionScheduleLoadBalancingStartDateLeveling(queryParams, {
    enabled: queryEnabled
  });
  const simulateMutation = usePostKioskProductionScheduleLoadBalancingStartDateLevelingSimulate();
  const displayData = simResult ?? loadQuery.data;

  useEffect(() => {
    setSimResult(null);
    simulateMutation.reset();
  }, [fromMonth, toMonth, bucket, focusMonth, resourceCd, scopeParams, simulateMutation]);

  const bucketKeys = useMemo(() => {
    if (!displayData) return [];
    return bucket === 'month' ? displayData.months : displayData.days;
  }, [displayData, bucket]);

  const { chartRows, resourceCds } = useMemo(() => {
    if (!displayData) {
      return { chartRows: [], resourceCds: [] as string[] };
    }
    return mapStartDateLevelingChartRows({
      bucketKeys,
      cells: displayData.cells,
      bucket
    });
  }, [displayData, bucketKeys, bucket]);

  const dayCompareRows = useMemo(() => {
    if (!displayData || bucket !== 'day' || resourceCd.trim().length === 0) {
      return [];
    }
    return mapStartDateLevelingDayCompareRows({
      days: displayData.days,
      cells: displayData.cells,
      resourceCd: resourceCd.trim().toUpperCase()
    });
  }, [displayData, bucket, resourceCd]);

  const handleSimulate = async () => {
    if (!selectedRowId.trim() || !simTargetDate.trim()) return;
    const result = await simulateMutation.mutateAsync({
      ...queryParams,
      moves: [{ rowId: selectedRowId.trim(), targetDate: simTargetDate.trim() }]
    });
    setSimResult(result);
  };

  return (
    <>
      <p className="max-w-3xl text-xs text-white/70">
        未完了部品工程の負荷を <strong className="font-semibold text-white">FSIGENSHOYORYO × 指示数</strong>{' '}
        で算出し、<strong className="font-semibold text-white">着手日</strong>（部品納期個数CSV）から{' '}
        <strong className="font-semibold text-white">有効納期</strong>（行備考 → plannedEndDate）までを資源CDごとの稼働日ルールで日割りします。シミュレーションはDBを更新しません。
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
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-white/90">表示</span>
          <div className="flex gap-1">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                bucket === 'month' ? 'bg-fuchsia-700 text-white' : 'bg-slate-800 text-white/80'
              }`}
              onClick={() => setBucket('month')}
            >
              月次
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                bucket === 'day' ? 'bg-fuchsia-700 text-white' : 'bg-slate-800 text-white/80'
              }`}
              onClick={() => setBucket('day')}
            >
              日次
            </button>
          </div>
        </div>
        {bucket === 'day' ? (
          <label className="flex flex-col gap-1 text-xs font-semibold text-white/90">
            日次の対象月
            <input
              type="month"
              value={focusMonth}
              onChange={(event) => setFocusMonth(event.target.value)}
              className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
            />
          </label>
        ) : null}
        <label className="flex min-w-[10rem] flex-col gap-1 text-xs font-semibold text-white/90">
          資源CD（任意）
          <input
            value={resourceCd}
            onChange={(event) => setResourceCd(event.target.value)}
            className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 font-mono text-white uppercase"
            placeholder="例: 021"
          />
        </label>
      </div>

      {loadQuery.error ? (
        <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-950/40 p-2 text-xs text-rose-100">
          読み込みエラー:{' '}
          {loadQuery.error instanceof Error ? loadQuery.error.message : String(loadQuery.error)}
        </div>
      ) : null}

      {loadQuery.isFetching ? <p className="mt-2 text-xs text-white/70">集計を読み込み中…</p> : null}

      {displayData ? (
        <p className="mt-2 text-[11px] text-white/60">
          siteKey: <span className="font-mono text-white/90">{displayData.siteKey}</span>
          {simResult ? <span className="ml-2 text-amber-200">（シミュレーション結果）</span> : null}
        </p>
      ) : null}

      <section className="mt-3 min-h-[260px] rounded-lg border border-white/15 bg-slate-950/50 p-2">
        <p className="mb-2 text-xs font-semibold text-white">
          {bucket === 'month' ? '月別・資源CD別（積み上げ・上位24）' : '日別・資源CD別（積み上げ・上位24）'}
        </p>
        {chartRows.length === 0 ? (
          <p className="text-xs text-white/60">表示できるデータがありません。</p>
        ) : (
          <div className="h-[280px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="bucket"
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={70}
                  tick={{ fill: '#e2e8f0', fontSize: 10 }}
                />
                <YAxis tick={{ fill: '#e2e8f0', fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#e2e8f0' }} />
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

      {bucket === 'day' && dayCompareRows.length > 0 ? (
        <section className="mt-3 min-h-[220px] rounded-lg border border-white/15 bg-slate-950/50 p-2">
          <p className="mb-2 text-xs font-semibold text-white">
            日次能力比較（資源 {resourceCd.trim().toUpperCase()}）
          </p>
          <div className="h-[220px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dayCompareRows} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="day"
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={70}
                  tick={{ fill: '#e2e8f0', fontSize: 9 }}
                />
                <YAxis tick={{ fill: '#e2e8f0', fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#e2e8f0' }} />
                <Bar dataKey="req" name="必要分" fill="#38bdf8" />
                <Bar dataKey="cap" name="日次能力" fill="#34d399" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <p className="mb-2 text-xs font-semibold text-white">資源CDサマリ</p>
        <div className="max-h-56 overflow-auto">
          <table className="w-full border-collapse text-left text-[11px] text-white/90">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-white/10">
                <th className="px-2 py-1">資源CD</th>
                <th className="px-2 py-1">稼働日</th>
                <th className="px-2 py-1">必要分</th>
                <th className="px-2 py-1">能力分</th>
                <th className="px-2 py-1">超過</th>
              </tr>
            </thead>
            <tbody>
              {(displayData?.resources ?? []).map((row) => (
                <tr key={row.resourceCd} className="border-b border-white/5">
                  <td className="px-2 py-1 font-mono">{row.resourceCd}</td>
                  <td className="px-2 py-1">
                    {row.workCalendarMode === 'calendar_days' ? '暦日' : '平日'}
                  </td>
                  <td className="px-2 py-1">{Math.round(row.requiredMinutes)}</td>
                  <td className="px-2 py-1">
                    {row.availableMinutes == null ? '—' : Math.round(row.availableMinutes)}
                  </td>
                  <td className="px-2 py-1">{Math.round(row.overMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
        <p className="mb-2 text-xs font-semibold text-amber-100">平準化シミュレーション（読み取り専用）</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[14rem] flex-col gap-1 text-xs font-semibold text-white/90">
            対象行
            <select
              value={selectedRowId}
              onChange={(event) => setSelectedRowId(event.target.value)}
              className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
            >
              <option value="">— 選択 —</option>
              {(displayData?.allocatedRows ?? []).map((row) => (
                <option key={row.rowId} value={row.rowId}>
                  {row.fseiban} / {row.fhincd} / {row.resourceCd}（{Math.round(row.totalMinutes)}分）
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-white/90">
            移動先日
            <input
              type="date"
              value={simTargetDate}
              onChange={(event) => setSimTargetDate(event.target.value)}
              className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
            />
          </label>
          <button
            type="button"
            className="rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={simulateMutation.isPending || !selectedRowId || !simTargetDate}
            onClick={() => void handleSimulate()}
          >
            {simulateMutation.isPending ? 'シミュレーション中…' : 'シミュレーション実行'}
          </button>
          {simResult ? (
            <button
              type="button"
              className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white"
              onClick={() => {
                setSimResult(null);
                simulateMutation.reset();
              }}
            >
              シミュ結果をクリア
            </button>
          ) : null}
        </div>
        {simulateMutation.error ? (
          <p className="mt-2 text-xs text-rose-200">
            {simulateMutation.error instanceof Error
              ? simulateMutation.error.message
              : String(simulateMutation.error)}
          </p>
        ) : null}
        {(simResult?.simulatedMoves ?? []).length > 0 ? (
          <div className="mt-2 max-h-40 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">行</th>
                  <th className="px-2 py-1">資源</th>
                  <th className="px-2 py-1">移動先</th>
                  <th className="px-2 py-1">分</th>
                </tr>
              </thead>
              <tbody>
                {simResult!.simulatedMoves.map((move) => (
                  <tr key={move.rowId} className="border-b border-white/5">
                    <td className="px-2 py-1 font-mono">{move.rowId.slice(0, 8)}…</td>
                    <td className="px-2 py-1 font-mono">{move.resourceCd}</td>
                    <td className="px-2 py-1 font-mono">{move.targetDate}</td>
                    <td className="px-2 py-1">{Math.round(move.movedMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {(displayData?.unallocatedRows ?? []).length > 0 ? (
        <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
          <p className="mb-2 text-xs font-semibold text-white">
            未配分（{displayData!.unallocatedRows.length}件）
          </p>
          <div className="max-h-48 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">製番</th>
                  <th className="px-2 py-1">品番</th>
                  <th className="px-2 py-1">資源</th>
                  <th className="px-2 py-1">理由</th>
                </tr>
              </thead>
              <tbody>
                {displayData!.unallocatedRows.slice(0, 100).map((row) => (
                  <tr key={row.rowId} className="border-b border-white/5">
                    <td className="px-2 py-1 font-mono">{row.fseiban || '—'}</td>
                    <td className="px-2 py-1 font-mono">{row.fhincd || '—'}</td>
                    <td className="px-2 py-1 font-mono">{row.resourceCd}</td>
                    <td className="px-2 py-1">{UNALLOCATED_LABELS[row.reason] ?? row.reason}</td>
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
