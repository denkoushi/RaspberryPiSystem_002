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
  useKioskProductionScheduleLoadBalancingOverview,
  usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates,
  usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate,
  usePostKioskProductionScheduleLoadBalancingSuggestions
} from '../../../api/hooks';

import {
  listOverResourceCds,
  toggleSelectedResourceCd,
  toggleSelectedRowId
} from './loadBalancingOutsourcingSelection';

function defaultYearMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

type ScopeParams = { targetDeviceScopeKey?: string };

type Props = {
  scopeParams: ScopeParams;
  scopeEnabled: boolean;
};

export function LoadBalancingOverviewTab({ scopeParams, scopeEnabled }: Props) {
  const [month, setMonth] = useState(defaultYearMonth);
  const [selectedOverResourceCds, setSelectedOverResourceCds] = useState<string[]>([]);
  const [selectedCandidateRowIds, setSelectedCandidateRowIds] = useState<string[]>([]);
  const [candidateResult, setCandidateResult] = useState<
    ReturnType<typeof usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates>['data'] | null
  >(null);
  const [simulateResult, setSimulateResult] = useState<
    ReturnType<typeof usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate>['data'] | null
  >(null);

  const overviewParams = useMemo(() => ({ month: month.trim(), ...scopeParams }), [month, scopeParams]);
  const overviewEnabled = /^\d{4}-\d{2}$/.test(month.trim()) && scopeEnabled;

  const overviewQuery = useKioskProductionScheduleLoadBalancingOverview(overviewParams, {
    enabled: overviewEnabled
  });
  const suggestionsMutation = usePostKioskProductionScheduleLoadBalancingSuggestions();
  const candidatesMutation = usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates();
  const simulateMutation = usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate();

  const overResourceOptions = useMemo(
    () => listOverResourceCds(overviewQuery.data?.resources ?? []),
    [overviewQuery.data?.resources]
  );

  const overResourceKey = useMemo(() => overResourceOptions.join('\t'), [overResourceOptions]);

  const resetOutsourcingState = () => {
    setSelectedCandidateRowIds([]);
    setCandidateResult(null);
    setSimulateResult(null);
    candidatesMutation.reset();
    simulateMutation.reset();
  };

  useEffect(() => {
    setSelectedOverResourceCds(overResourceOptions);
    setSelectedCandidateRowIds([]);
    setCandidateResult(null);
    setSimulateResult(null);
    candidatesMutation.reset();
    simulateMutation.reset();
    suggestionsMutation.reset();
  }, [month, scopeParams, overResourceKey, overResourceOptions, suggestionsMutation, candidatesMutation, simulateMutation]);

  const displayResources = useMemo(
    () => simulateResult?.afterResources ?? overviewQuery.data?.resources ?? [],
    [simulateResult?.afterResources, overviewQuery.data?.resources]
  );

  const chartSlice = useMemo(() => {
    const mapped = displayResources.map((resource) => ({
      cd: resource.resourceCd,
      req: Math.round(resource.requiredMinutes),
      cap: resource.availableMinutes == null ? 0 : Math.round(resource.availableMinutes),
      over: Math.round(resource.overMinutes),
      klass: resource.classCode ?? ''
    }));
    return mapped.sort((a, b) => b.req - a.req).slice(0, 48);
  }, [displayResources]);

  const handleSuggest = async () => {
    await suggestionsMutation.mutateAsync({
      ...overviewParams,
      maxSuggestions: 40,
      overResourceCds: selectedOverResourceCds.length > 0 ? selectedOverResourceCds : undefined
    });
  };

  const handleLoadCandidates = async () => {
    const result = await candidatesMutation.mutateAsync({
      ...overviewParams,
      maxCandidates: 100,
      overResourceCds: selectedOverResourceCds.length > 0 ? selectedOverResourceCds : undefined
    });
    setCandidateResult(result);
    setSelectedCandidateRowIds([]);
    setSimulateResult(null);
    simulateMutation.reset();
  };

  const handleSimulate = async () => {
    const result = await simulateMutation.mutateAsync({
      ...overviewParams,
      overResourceCds: selectedOverResourceCds.length > 0 ? selectedOverResourceCds : undefined,
      selectedRowIds: selectedCandidateRowIds
    });
    setSimulateResult(result);
  };

  const beforeResourceMap = useMemo(() => {
    const map = new Map<string, { requiredMinutes: number; overMinutes: number }>();
    for (const resource of simulateResult?.beforeResources ?? overviewQuery.data?.resources ?? []) {
      map.set(resource.resourceCd, {
        requiredMinutes: resource.requiredMinutes,
        overMinutes: resource.overMinutes
      });
    }
    return map;
  }, [overviewQuery.data?.resources, simulateResult?.beforeResources]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <p className="max-w-3xl text-xs text-white/70">
          <code className="text-white/90">plannedEndDate</code>（受注補足）の月と一致する未完了工程を集計し、資源CD別の必要工数と能力を比較します。
          社内移管サジェストと、外注候補（社内負荷から除外する試算）は別機能です。いずれも自動適用しません。
        </p>
        <label className="flex flex-col gap-1 text-xs font-semibold text-white/90">
          対象月
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
          />
        </label>
        <button
          type="button"
          className="rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          disabled={!overviewEnabled || suggestionsMutation.isPending}
          onClick={() => void handleSuggest()}
        >
          {suggestionsMutation.isPending ? 'サジェスト計算中…' : '社内移管サジェストを計算'}
        </button>
      </div>

      {overviewQuery.error ? (
        <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-950/40 p-2 text-xs text-rose-100">
          読み込みエラー:{' '}
          {overviewQuery.error instanceof Error ? overviewQuery.error.message : String(overviewQuery.error)}
        </div>
      ) : null}

      {overviewQuery.isFetching ? <p className="mt-2 text-xs text-white/70">集計を読み込み中…</p> : null}

      {overviewQuery.data ? (
        <p className="mt-2 text-[11px] text-white/60">
          siteKey: <span className="font-mono text-white/90">{overviewQuery.data.siteKey}</span> / yearMonth:{' '}
          <span className="font-mono text-white/90">{overviewQuery.data.yearMonth}</span>（計画完了月）
          {simulateResult ? <span className="ml-2 text-amber-200">（外注シミュ結果）</span> : null}
        </p>
      ) : null}

      <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-white">超過資源の選択</p>
          <button
            type="button"
            className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white"
            onClick={() => {
              setSelectedOverResourceCds(overResourceOptions);
              resetOutsourcingState();
            }}
          >
            超過資源をすべて選択
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white"
            onClick={() => {
              setSelectedOverResourceCds([]);
              resetOutsourcingState();
            }}
          >
            選択解除
          </button>
        </div>
        {overResourceOptions.length === 0 ? (
          <p className="text-xs text-white/60">超過資源はありません。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {overResourceOptions.map((resourceCd) => {
              const selected = selectedOverResourceCds.includes(resourceCd);
              const overMinutes = overviewQuery.data?.resources.find((resource) => resource.resourceCd === resourceCd)
                ?.overMinutes;
              return (
                <button
                  key={resourceCd}
                  type="button"
                  aria-pressed={selected}
                  className={`rounded-md px-2 py-1 text-[11px] font-mono ${
                    selected ? 'bg-amber-600 text-white' : 'bg-slate-800 text-white/80'
                  }`}
                  onClick={() => {
                    setSelectedOverResourceCds((current) => toggleSelectedResourceCd(current, resourceCd));
                    resetOutsourcingState();
                  }}
                >
                  {resourceCd} (+{Math.round(overMinutes ?? 0)}分)
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-3 min-h-[260px] flex-1 rounded-lg border border-white/15 bg-slate-950/50 p-2">
        <p className="mb-2 text-xs font-semibold text-white">資源CD別（上位48・必要分降順）</p>
        {chartSlice.length === 0 ? (
          <p className="text-xs text-white/60">表示できるデータがありません（対象月・条件を確認してください）。</p>
        ) : (
          <div className="h-[280px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartSlice} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="cd"
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={70}
                  tick={{ fill: '#e2e8f0', fontSize: 10 }}
                />
                <YAxis tick={{ fill: '#e2e8f0', fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#e2e8f0' }} />
                <Bar dataKey="req" name="必要分" fill="#38bdf8" />
                <Bar dataKey="cap" name="能力分" fill="#34d399" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <p className="mb-2 text-xs font-semibold text-white">明細（全資源）</p>
        <div className="max-h-72 overflow-auto">
          <table className="w-full border-collapse text-left text-[11px] text-white/90">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-white/10">
                <th className="px-2 py-1">資源CD</th>
                <th className="px-2 py-1">必要分</th>
                <th className="px-2 py-1">能力分</th>
                <th className="px-2 py-1">超過</th>
                {simulateResult ? (
                  <>
                    <th className="px-2 py-1">試算後必要分</th>
                    <th className="px-2 py-1">試算後超過</th>
                  </>
                ) : null}
                <th className="px-2 py-1">分類</th>
              </tr>
            </thead>
            <tbody>
              {displayResources.map((resource) => {
                const before = beforeResourceMap.get(resource.resourceCd);
                return (
                  <tr key={resource.resourceCd} className="border-b border-white/5">
                    <td className="px-2 py-1 font-mono">{resource.resourceCd}</td>
                    <td className="px-2 py-1">{Math.round(before?.requiredMinutes ?? resource.requiredMinutes)}</td>
                    <td className="px-2 py-1">
                      {resource.availableMinutes == null ? '—' : Math.round(resource.availableMinutes)}
                    </td>
                    <td className="px-2 py-1">{Math.round(before?.overMinutes ?? resource.overMinutes)}</td>
                    {simulateResult ? (
                      <>
                        <td className="px-2 py-1">{Math.round(resource.requiredMinutes)}</td>
                        <td className="px-2 py-1">{Math.round(resource.overMinutes)}</td>
                      </>
                    ) : null}
                    <td className="px-2 py-1">{resource.classCode ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-amber-100">外注候補（社内負荷から除外する試算）</p>
          <button
            type="button"
            className="rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={!overviewEnabled || candidatesMutation.isPending || selectedOverResourceCds.length === 0}
            onClick={() => void handleLoadCandidates()}
          >
            {candidatesMutation.isPending ? '候補取得中…' : '外注候補を取得'}
          </button>
          <button
            type="button"
            className="rounded-md bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={
              !overviewEnabled ||
              simulateMutation.isPending ||
              selectedCandidateRowIds.length === 0 ||
              candidateResult == null
            }
            onClick={() => void handleSimulate()}
          >
            {simulateMutation.isPending ? 'シミュレーション中…' : '選択行で累積シミュ'}
          </button>
          {simulateResult ? (
            <button
              type="button"
              className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white"
              onClick={() => {
                setSimulateResult(null);
                simulateMutation.reset();
              }}
            >
              シミュ結果をクリア
            </button>
          ) : null}
        </div>
        {candidatesMutation.isError ? (
          <p className="mb-2 text-xs text-rose-200">
            {candidatesMutation.error instanceof Error
              ? candidatesMutation.error.message
              : String(candidatesMutation.error)}
          </p>
        ) : null}
        {simulateMutation.isError ? (
          <p className="mb-2 text-xs text-rose-200">
            {simulateMutation.error instanceof Error
              ? simulateMutation.error.message
              : String(simulateMutation.error)}
          </p>
        ) : null}
        {(candidateResult?.candidates ?? []).length === 0 ? (
          <p className="text-xs text-white/60">
            超過資源を選び「外注候補を取得」を押してください。候補は超過改善効果の大きい順です（DBは更新しません）。
          </p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">選択</th>
                  <th className="px-2 py-1">効果</th>
                  <th className="px-2 py-1">製番</th>
                  <th className="px-2 py-1">注文</th>
                  <th className="px-2 py-1">品番</th>
                  <th className="px-2 py-1">資源CD</th>
                  <th className="px-2 py-1">行分</th>
                </tr>
              </thead>
              <tbody>
                {(candidateResult?.candidates ?? []).map((candidate) => (
                  <tr key={candidate.rowId} className="border-b border-white/5">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selectedCandidateRowIds.includes(candidate.rowId)}
                        aria-label={`${candidate.fseiban} ${candidate.fhincd} を外注候補に選択`}
                        onChange={() =>
                          setSelectedCandidateRowIds((current) =>
                            toggleSelectedRowId(current, candidate.rowId)
                          )
                        }
                      />
                    </td>
                    <td className="px-2 py-1">{Math.round(candidate.overReductionMinutes)}</td>
                    <td className="px-2 py-1 font-mono">{candidate.fseiban}</td>
                    <td className="px-2 py-1 font-mono">{candidate.productNo}</td>
                    <td className="px-2 py-1 font-mono">{candidate.fhincd}</td>
                    <td className="px-2 py-1 font-mono">{candidate.resourceCd}</td>
                    <td className="px-2 py-1">{Math.round(candidate.rowMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {simulateResult ? (
          <div className="mt-3 rounded-md border border-amber-500/20 bg-slate-950/40 p-2 text-[11px] text-white/80">
            <p>
              選択 {simulateResult.summary.selectedCount} 件 / 適用 {simulateResult.summary.appliedCount} 件 /
              スキップ {simulateResult.summary.skippedCount} 件
            </p>
            <p>
              社内負荷削減合計 {Math.round(simulateResult.summary.totalReducedMinutes)} 分 / 残超過{' '}
              {Math.round(simulateResult.summary.remainingOverMinutes)} 分
            </p>
          </div>
        ) : null}
      </section>

      <section className="mt-3 rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-white">社内移管サジェスト（工程行）</p>
          {suggestionsMutation.isError ? (
            <span className="text-[11px] text-rose-200">
              {suggestionsMutation.error instanceof Error ? suggestionsMutation.error.message : 'エラー'}
            </span>
          ) : null}
        </div>
        {(suggestionsMutation.data?.suggestions ?? []).length === 0 ? (
          <p className="text-xs text-white/60">
            「社内移管サジェストを計算」を押すと候補が表示されます（超過資源・分類・移管ルール・移管先余力に依存）。
          </p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">製番</th>
                  <th className="px-2 py-1">注文</th>
                  <th className="px-2 py-1">品番</th>
                  <th className="px-2 py-1">から→へ</th>
                  <th className="px-2 py-1">行分</th>
                  <th className="px-2 py-1">移管後超過(元)</th>
                  <th className="px-2 py-1">移管後超過(先)</th>
                  <th className="px-2 py-1">ルール</th>
                </tr>
              </thead>
              <tbody>
                {(suggestionsMutation.data?.suggestions ?? []).map((suggestion) => (
                  <tr key={suggestion.rowId} className="border-b border-white/5">
                    <td className="px-2 py-1 font-mono">{suggestion.fseiban}</td>
                    <td className="px-2 py-1 font-mono">{suggestion.productNo}</td>
                    <td className="px-2 py-1 font-mono">{suggestion.fhincd}</td>
                    <td className="px-2 py-1 font-mono">
                      {suggestion.resourceCdFrom}→{suggestion.resourceCdTo}
                    </td>
                    <td className="px-2 py-1">{Math.round(suggestion.rowMinutes)}</td>
                    <td className="px-2 py-1">{Math.round(suggestion.simulatedSourceOverAfter)}</td>
                    <td className="px-2 py-1">{Math.round(suggestion.simulatedDestinationOverAfter)}</td>
                    <td className="px-2 py-1 text-[10px] text-white/70">
                      {suggestion.fromClassCode}→{suggestion.toClassCode} / pri{suggestion.rulePriority} / eff
                      {suggestion.efficiencyRatio}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
