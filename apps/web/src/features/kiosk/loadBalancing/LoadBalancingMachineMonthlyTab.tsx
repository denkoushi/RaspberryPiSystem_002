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

import { useKioskProductionScheduleLoadBalancingMachineMonthlyLoad } from '../../../api/hooks';

import { LoadBalancingChartContainer } from './LoadBalancingChartContainer';
import { defaultMachineMonthlyRange, isValidYearMonth } from './loadBalancingMonthRange';
import { LoadBalancingProductionSystemNote } from './LoadBalancingProductionSystemNote';
import { LoadBalancingTabLoadingStatus } from './LoadBalancingTabLoadingStatus';
import {
  lbBtn,
  lbCard,
  lbError,
  lbForm,
  lbInput,
  lbPage,
  lbTable,
  lbText
} from './loadBalancingUiClasses';
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

  const isInitialLoad = loadQuery.isFetching && !loadQuery.data;
  const isRefreshing = loadQuery.isFetching && Boolean(loadQuery.data);

  const partTableRows = useMemo(() => {
    return (loadQuery.data?.parts ?? []).map((part) => {
      const active = selectedFhincd === part.fhincd;
      return (
        <tr
          key={part.fhincd}
          className={`${lbTable.interactiveRow} ${active ? lbTable.interactiveRowActive : ''}`}
          onClick={() => setSelectedFhincd(part.fhincd)}
        >
          <td className={lbTable.cellMono}>{part.fhincd}</td>
          <td className={lbTable.bodyCell}>{part.fhinmei || '—'}</td>
          <td className={lbTable.cellMono}>{part.effectiveDueDateMin ?? '—'}</td>
          <td className={lbTable.valueCell}>{Math.round(part.totalRequiredMinutes)}</td>
          <td className={lbTable.cellMono}>{part.resourceCds.join(', ')}</td>
        </tr>
      );
    });
  }, [loadQuery.data?.parts, selectedFhincd]);

  const resourceMonthTableRows = useMemo(() => {
    return (loadQuery.data?.resourceMonths ?? []).map((cell) => (
      <tr key={`${cell.month}-${cell.resourceCd}`} className={lbTable.bodyRow}>
        <td className={lbTable.cellMono}>{cell.month}</td>
        <td className={lbTable.cellMono}>{cell.resourceCd}</td>
        <td className={lbTable.valueCell}>{Math.round(cell.requiredMinutes)}</td>
      </tr>
    ));
  }, [loadQuery.data?.resourceMonths]);

  const partRowTableRows = useMemo(() => {
    return (loadQuery.data?.partRows ?? []).map((row) => (
      <tr key={row.rowId} className={lbTable.bodyRow}>
        <td className={lbTable.cellMono}>{row.effectiveDueDate}</td>
        <td className={lbTable.cellMono}>{row.fseiban}</td>
        <td className={lbTable.cellMono}>{row.fhincd}</td>
        <td className={lbTable.cellMono}>{row.resourceCd}</td>
        <td className={lbTable.bodyCell}>{row.fkojun ?? '—'}</td>
        <td className={lbTable.valueCell}>{Math.round(row.requiredMinutes)}</td>
        <td className={lbTable.bodyCell}>{row.effectiveDueDateSource === 'manual' ? '備考' : 'CSV'}</td>
      </tr>
    ));
  }, [loadQuery.data?.partRows]);

  return (
    <div className={lbPage.stack}>
      <p className={`max-w-3xl ${lbText.body}`}>
        機種（製番の MH/SH 行 <code className="text-white/90">FHINMEI</code>）を選び、未完了部品工程の{' '}
        <strong className="font-semibold text-white">有効納期</strong>（行備考 → なければ plannedEndDate）の月で資源CD別所要量を表示します。山崩しタブの単月集計（計画完了月）とは月の定義が異なります。
      </p>

      <LoadBalancingProductionSystemNote />

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
          <label className={lbForm.fieldGroup}>
            <span className="text-sm font-semibold text-white/90">機種（FHINMEI）</span>
            <select
              value={selectedMachineName}
              onChange={(event) => setSelectedMachineName(event.target.value)}
              className={lbForm.field}
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
              className={`${lbBtn.slate} inline-flex h-10 min-h-10 items-center`}
              onClick={() => setSelectedFhincd('')}
            >
              部品絞り込み解除 ({selectedFhincd})
            </button>
          ) : null}
        </div>
      </section>

      {loadQuery.error ? (
        <div className={lbError.banner}>
          読み込みエラー:{' '}
          {loadQuery.error instanceof Error ? loadQuery.error.message : String(loadQuery.error)}
        </div>
      ) : null}

      <LoadBalancingTabLoadingStatus isInitialLoad={isInitialLoad} isRefreshing={isRefreshing} />

      {loadQuery.data ? (
        <p className={lbText.meta}>
          siteKey: <span className="font-mono text-white/90">{loadQuery.data.siteKey}</span> /{' '}
          <span className="font-mono text-white/90">
            {loadQuery.data.fromMonth}〜{loadQuery.data.toMonth}
          </span>
          （有効納期月）
        </p>
      ) : null}

      <section className={lbCard.base}>
        <p className={`mb-2 ${lbText.section}`}>月別・資源CD別（積み上げ・上位24資源）</p>
        {!selectedMachineName ? (
          <p className={lbText.muted}>機種を選択するとグラフを表示します。</p>
        ) : chartRows.length === 0 || resourceCds.length === 0 ? (
          <p className={lbText.muted}>表示できるデータがありません。</p>
        ) : (
          <LoadBalancingChartContainer heightClassName="h-[300px] w-full min-w-0">
            <BarChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={{ fill: '#e2e8f0', fontSize: 12 }} />
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

      <section className={lbCard.base}>
        <p className={`mb-2 ${lbText.section}`}>部品一覧（選択機種）</p>
        {!selectedMachineName ? (
          <p className={lbText.muted}>機種を選択してください。</p>
        ) : (
          <div className={lbTable.scrollBox}>
            <table className={lbTable.root}>
              <thead className={lbTable.stickyHead}>
                <tr className={lbTable.headRow}>
                  <th className={lbTable.headCell}>品番</th>
                  <th className={lbTable.headCell}>品名</th>
                  <th className={lbTable.headCell}>最早納期</th>
                  <th className={lbTable.headCell}>所要分</th>
                  <th className={lbTable.headCell}>資源</th>
                </tr>
              </thead>
              <tbody>{partTableRows}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={lbCard.base}>
        <p className={`mb-2 ${lbText.section}`}>明細（月×資源CD）</p>
        {!selectedMachineName ? (
          <p className={lbText.muted}>機種を選択してください。</p>
        ) : (
          <div className={lbTable.scrollBoxLg}>
            <table className={lbTable.root}>
              <thead className={lbTable.stickyHead}>
                <tr className={lbTable.headRow}>
                  <th className={lbTable.headCell}>月</th>
                  <th className={lbTable.headCell}>資源CD</th>
                  <th className={lbTable.headCell}>必要分</th>
                </tr>
              </thead>
              <tbody>{resourceMonthTableRows}</tbody>
            </table>
          </div>
        )}
      </section>

      {selectedMachineName && (loadQuery.data?.partRows.length ?? 0) > 0 ? (
        <section className={lbCard.base}>
          <p className={`mb-2 ${lbText.section}`}>
            工程行（{selectedFhincd ? `品番 ${selectedFhincd}` : '全件'}）
          </p>
          <div className={lbTable.scrollBoxMd}>
            <table className={lbTable.root}>
              <thead className={lbTable.stickyHead}>
                <tr className={lbTable.headRow}>
                  <th className={lbTable.headCell}>納期</th>
                  <th className={lbTable.headCell}>製番</th>
                  <th className={lbTable.headCell}>品番</th>
                  <th className={lbTable.headCell}>資源</th>
                  <th className={lbTable.headCell}>工順</th>
                  <th className={lbTable.headCell}>分</th>
                  <th className={lbTable.headCell}>納期元</th>
                </tr>
              </thead>
              <tbody>{partRowTableRows}</tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
