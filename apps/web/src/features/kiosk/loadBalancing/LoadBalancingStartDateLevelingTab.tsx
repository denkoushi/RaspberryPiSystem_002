import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import {
  useKioskProductionScheduleLoadBalancingStartDateLeveling,
  usePostKioskProductionScheduleLoadBalancingStartDateLevelingSimulate
} from '../../../api/hooks';

import { LoadBalancingChartContainer } from './LoadBalancingChartContainer';
import { defaultMachineMonthlyRange, isValidYearMonth } from './loadBalancingMonthRange';
import { LoadBalancingTabLoadingStatus } from './LoadBalancingTabLoadingStatus';
import {
  lbBtn,
  lbCard,
  lbError,
  lbForm,
  lbInput,
  lbPage,
  lbTabClassName,
  lbTable,
  lbText
} from './loadBalancingUiClasses';
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

  const isInitialLoad = loadQuery.isFetching && !loadQuery.data;
  const isRefreshing = loadQuery.isFetching && Boolean(loadQuery.data);

  const resourceSummaryRows = useMemo(() => {
    return (displayData?.resources ?? []).map((row) => (
      <tr key={row.resourceCd} className={lbTable.bodyRow}>
        <td className={lbTable.cellMono}>{row.resourceCd}</td>
        <td className={lbTable.bodyCell}>
          {row.workCalendarMode === 'calendar_days' ? '暦日' : '平日'}
        </td>
        <td className={lbTable.valueCell}>{Math.round(row.requiredMinutes)}</td>
        <td className={lbTable.valueCell}>
          {row.availableMinutes == null ? '—' : Math.round(row.availableMinutes)}
        </td>
        <td className={lbTable.valueCell}>{Math.round(row.overMinutes)}</td>
      </tr>
    ));
  }, [displayData?.resources]);

  const simulatedMoveRows = useMemo(() => {
    return (simResult?.simulatedMoves ?? []).map((move) => (
      <tr key={move.rowId} className={lbTable.bodyRow}>
        <td className={lbTable.cellMono}>{move.rowId.slice(0, 8)}…</td>
        <td className={lbTable.cellMono}>{move.resourceCd}</td>
        <td className={lbTable.cellMono}>{move.targetDate}</td>
        <td className={lbTable.valueCell}>{Math.round(move.movedMinutes)}</td>
      </tr>
    ));
  }, [simResult?.simulatedMoves]);

  const unallocatedRows = useMemo(() => {
    return (displayData?.unallocatedRows ?? []).slice(0, 100).map((row) => (
      <tr key={row.rowId} className={lbTable.bodyRow}>
        <td className={lbTable.cellMono}>{row.fseiban || '—'}</td>
        <td className={lbTable.cellMono}>{row.fhincd || '—'}</td>
        <td className={lbTable.cellMono}>{row.resourceCd}</td>
        <td className={lbTable.bodyCell}>{UNALLOCATED_LABELS[row.reason] ?? row.reason}</td>
      </tr>
    ));
  }, [displayData?.unallocatedRows]);

  const handleSimulate = async () => {
    if (!selectedRowId.trim() || !simTargetDate.trim()) return;
    const result = await simulateMutation.mutateAsync({
      ...queryParams,
      moves: [{ rowId: selectedRowId.trim(), targetDate: simTargetDate.trim() }]
    });
    setSimResult(result);
  };

  return (
    <div className={lbPage.stack}>
      <p className={`max-w-3xl ${lbText.body}`}>
        未完了部品工程の負荷を <strong className="font-semibold text-white">行総分</strong>（工程行の所要量合算。指示数は掛けません）で算出し、
        <strong className="font-semibold text-white">着手日</strong>（部品納期個数CSV）から{' '}
        <strong className="font-semibold text-white">有効納期</strong>（行備考 → plannedEndDate）までを資源CDごとの稼働日ルールで日割りします。シミュレーションはDBを更新しません。
      </p>

      <section className={lbCard.base}>
        <div className={lbForm.row}>
          <label className={lbForm.label}>
            開始月
            <input
              type="month"
              value={fromMonth}
              onChange={(event) => setFromMonth(event.target.value)}
              className={lbInput.month}
            />
          </label>
          <label className={lbForm.label}>
            終了月
            <input
              type="month"
              value={toMonth}
              onChange={(event) => setToMonth(event.target.value)}
              className={lbInput.month}
            />
          </label>
          <div className={lbForm.fieldGroupSm}>
            <span className="text-sm font-semibold text-white/90">表示</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`inline-flex h-10 min-h-10 items-center ${lbTabClassName(bucket === 'month')}`}
                onClick={() => setBucket('month')}
              >
                月次
              </button>
              <button
                type="button"
                className={`inline-flex h-10 min-h-10 items-center ${lbTabClassName(bucket === 'day')}`}
                onClick={() => setBucket('day')}
              >
                日次
              </button>
            </div>
          </div>
          {bucket === 'day' ? (
            <label className={lbForm.label}>
              日次の対象月
              <input
                type="month"
                value={focusMonth}
                onChange={(event) => setFocusMonth(event.target.value)}
                className={lbInput.month}
              />
            </label>
          ) : null}
          <label className={lbForm.fieldGroupSm}>
            <span className="text-sm font-semibold text-white/90">資源CD（任意）</span>
            <input
              value={resourceCd}
              onChange={(event) => setResourceCd(event.target.value)}
              className={lbForm.fieldMono}
              placeholder="例: 021"
            />
          </label>
        </div>
      </section>

      {loadQuery.error ? (
        <div className={lbError.banner}>
          読み込みエラー:{' '}
          {loadQuery.error instanceof Error ? loadQuery.error.message : String(loadQuery.error)}
        </div>
      ) : null}

      <LoadBalancingTabLoadingStatus isInitialLoad={isInitialLoad} isRefreshing={isRefreshing} />

      {displayData ? (
        <p className={lbText.meta}>
          siteKey: <span className="font-mono text-white/90">{displayData.siteKey}</span>
          {simResult ? <span className="ml-2 text-amber-200">（シミュレーション結果）</span> : null}
        </p>
      ) : null}

      <section className={`min-h-[260px] ${lbCard.base}`}>
        <p className={`mb-2 ${lbText.section}`}>
          {bucket === 'month' ? '月別・資源CD別（積み上げ・上位24）' : '日別・資源CD別（積み上げ・上位24）'}
        </p>
        {chartRows.length === 0 ? (
          <p className={lbText.muted}>表示できるデータがありません。</p>
        ) : (
          <LoadBalancingChartContainer heightClassName="h-[280px] w-full min-w-0">
            <BarChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="bucket"
                angle={-35}
                textAnchor="end"
                interval={0}
                height={70}
                tick={{ fill: '#e2e8f0', fontSize: 12 }}
              />
              <YAxis tick={{ fill: '#e2e8f0', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 13 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#e2e8f0' }} />
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
          </LoadBalancingChartContainer>
        )}
      </section>

      {bucket === 'day' && dayCompareRows.length > 0 ? (
        <section className={`min-h-[220px] ${lbCard.base}`}>
          <p className={`mb-2 ${lbText.section}`}>
            日次能力比較（資源 {resourceCd.trim().toUpperCase()}）
          </p>
          <LoadBalancingChartContainer heightClassName="h-[220px] w-full min-w-0">
            <BarChart data={dayCompareRows} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="day"
                angle={-35}
                textAnchor="end"
                interval={0}
                height={70}
                tick={{ fill: '#e2e8f0', fontSize: 11 }}
              />
              <YAxis tick={{ fill: '#e2e8f0', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 13 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#e2e8f0' }} />
              <Bar dataKey="req" name="必要分" fill="#38bdf8" />
              <Bar dataKey="cap" name="日次能力" fill="#34d399" />
            </BarChart>
          </LoadBalancingChartContainer>
        </section>
      ) : null}

      <section className={lbCard.base}>
        <p className={`mb-2 ${lbText.section}`}>資源CDサマリ</p>
        <div className={lbTable.scrollBox}>
          <table className={lbTable.root}>
            <thead className={lbTable.stickyHead}>
              <tr className={lbTable.headRow}>
                <th className={lbTable.headCell}>資源CD</th>
                <th className={lbTable.headCell}>稼働日</th>
                <th className={lbTable.headCell}>必要分</th>
                <th className={lbTable.headCell}>能力分</th>
                <th className={lbTable.headCell}>超過</th>
              </tr>
            </thead>
            <tbody>{resourceSummaryRows}</tbody>
          </table>
        </div>
      </section>

      <section className={lbCard.amber}>
        <p className={`mb-2 ${lbText.section} text-amber-100`}>平準化シミュレーション（読み取り専用）</p>
        <div className={lbForm.row}>
          <label className={lbForm.fieldGroupLg}>
            <span className="text-sm font-semibold text-white/90">対象行</span>
            <select
              value={selectedRowId}
              onChange={(event) => setSelectedRowId(event.target.value)}
              className={lbForm.field}
            >
              <option value="">— 選択 —</option>
              {(displayData?.allocatedRows ?? []).map((row) => (
                <option key={row.rowId} value={row.rowId}>
                  {row.fseiban} / {row.fhincd} / {row.resourceCd}（{Math.round(row.totalMinutes)}分）
                </option>
              ))}
            </select>
          </label>
          <label className={lbForm.label}>
            移動先日
            <input
              type="date"
              value={simTargetDate}
              onChange={(event) => setSimTargetDate(event.target.value)}
              className={lbForm.field}
            />
          </label>
          <button
            type="button"
            className={`${lbBtn.amber} inline-flex h-10 min-h-10 items-center`}
            disabled={simulateMutation.isPending || !selectedRowId || !simTargetDate}
            onClick={() => void handleSimulate()}
          >
            {simulateMutation.isPending ? 'シミュレーション中…' : 'シミュレーション実行'}
          </button>
          {simResult ? (
            <button
              type="button"
              className={`${lbBtn.slate} inline-flex h-10 min-h-10 items-center`}
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
          <p className={`mt-2 ${lbText.error}`}>
            {simulateMutation.error instanceof Error
              ? simulateMutation.error.message
              : String(simulateMutation.error)}
          </p>
        ) : null}
        {(simResult?.simulatedMoves ?? []).length > 0 ? (
          <div className={`mt-2 ${lbTable.scrollBox}`}>
            <table className={lbTable.root}>
              <thead>
                <tr className={lbTable.headRow}>
                  <th className={lbTable.headCell}>行</th>
                  <th className={lbTable.headCell}>資源</th>
                  <th className={lbTable.headCell}>移動先</th>
                  <th className={lbTable.headCell}>分</th>
                </tr>
              </thead>
              <tbody>{simulatedMoveRows}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      {(displayData?.unallocatedRows ?? []).length > 0 ? (
        <section className={lbCard.base}>
          <p className={`mb-2 ${lbText.section}`}>
            未配分（{displayData!.unallocatedRows.length}件）
          </p>
          <div className={lbTable.scrollBox}>
            <table className={lbTable.root}>
              <thead className={lbTable.stickyHead}>
                <tr className={lbTable.headRow}>
                  <th className={lbTable.headCell}>製番</th>
                  <th className={lbTable.headCell}>品番</th>
                  <th className={lbTable.headCell}>資源</th>
                  <th className={lbTable.headCell}>理由</th>
                </tr>
              </thead>
              <tbody>{unallocatedRows}</tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
