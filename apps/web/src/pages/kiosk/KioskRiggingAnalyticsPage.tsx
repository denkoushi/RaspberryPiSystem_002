import clsx from 'clsx';
import { useState } from 'react';
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

import { useRiggingLoanAnalytics } from '../../features/rigging-analytics/useRiggingLoanAnalytics';

import type { RiggingLoanAnalyticsByEmployeeRow, RiggingLoanAnalyticsByGearRow } from '../../api/types';

const tooltipStyle = {
  backgroundColor: 'rgb(30 41 59)',
  border: '1px solid rgb(51 65 85)',
  borderRadius: 8,
  fontSize: 14
};

const axisTick = { fill: 'rgb(226 232 240)', fontSize: 14 };

function formatYearMonthJa(ym: string): string {
  const [y, m] = ym.split('-').map((s) => Number(s));
  if (!y || !m) return ym;
  return `${y}年${m}月`;
}

function formatDt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

const RIGGING_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: '利用可',
  IN_USE: '貸出中',
  MAINTENANCE: '整備',
  RETIRED: '廃棄'
};

function PeriodMixBar({ borrow, ret, ariaLabel }: { borrow: number; ret: number; ariaLabel: string }) {
  const sum = borrow + ret;
  if (sum <= 0) {
    return <div className="h-3 w-full max-w-[200px] rounded bg-white/10" aria-label={ariaLabel} />;
  }
  const borW = (borrow / sum) * 100;
  const retW = (ret / sum) * 100;
  return (
    <div
      className="flex h-3 w-full max-w-[200px] overflow-hidden rounded bg-white/10"
      title={`持出 ${borrow} / 返却 ${ret}`}
      aria-label={ariaLabel}
    >
      <div className="h-full shrink-0 bg-emerald-400/90" style={{ width: `${borW}%` }} />
      <div className="h-full shrink-0 bg-sky-400/90" style={{ width: `${retW}%` }} />
    </div>
  );
}

function GearTable({ rows }: { rows: RiggingLoanAnalyticsByGearRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[920px] text-left text-base">
        <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
          <tr className="border-b border-white/10 text-white/65">
            <th className="px-3 py-3 font-semibold">管理番号</th>
            <th className="px-3 py-3 font-semibold">名称</th>
            <th className="px-3 py-3 font-semibold">状態</th>
            <th className="px-3 py-3 font-semibold">貸出</th>
            <th className="px-3 py-3 font-semibold">借用者</th>
            <th className="px-3 py-3 font-semibold">期限</th>
            <th className="px-3 py-3 font-semibold">期間内 持出</th>
            <th className="px-3 py-3 font-semibold">期間内 返却</th>
            <th className="px-3 py-3 font-semibold">期間内 割合</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.gearId}
              className={clsx(
                'border-b border-white/5',
                row.openIsOverdue && 'bg-red-950/40',
                !row.openIsOverdue && row.isOutNow && 'bg-amber-950/25'
              )}
            >
              <td className="px-3 py-3 font-mono text-white">{row.managementNumber}</td>
              <td className="px-3 py-3 font-medium text-white">{row.name}</td>
              <td className="px-3 py-3 text-slate-200">{RIGGING_STATUS_LABEL[row.status] ?? row.status}</td>
              <td className="px-3 py-3">
                {row.isOutNow ? (
                  <span className="rounded-md bg-amber-500/25 px-2 py-1 text-amber-100">貸出中</span>
                ) : (
                  <span className="text-white/45">在庫</span>
                )}
                {row.openIsOverdue ? (
                  <span className="ml-2 rounded-md bg-red-500/30 px-2 py-1 text-red-100">期限超過</span>
                ) : null}
              </td>
              <td className="px-3 py-3 text-slate-100">{row.currentBorrowerDisplayName ?? '—'}</td>
              <td className="px-3 py-3 tabular-nums text-slate-200">{formatDt(row.dueAt)}</td>
              <td className="px-3 py-3 tabular-nums text-emerald-200">{row.periodBorrowCount}</td>
              <td className="px-3 py-3 tabular-nums text-sky-200">{row.periodReturnCount}</td>
              <td className="px-3 py-3">
                <PeriodMixBar
                  borrow={row.periodBorrowCount}
                  ret={row.periodReturnCount}
                  ariaLabel={`${row.name} 期間内 持出${row.periodBorrowCount} 返却${row.periodReturnCount}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeTable({ rows }: { rows: RiggingLoanAnalyticsByEmployeeRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[780px] text-left text-base">
        <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
          <tr className="border-b border-white/10 text-white/65">
            <th className="px-3 py-3 font-semibold">氏名</th>
            <th className="px-3 py-3 font-semibold">コード</th>
            <th className="px-3 py-3 font-semibold">現在 未返却</th>
            <th className="px-3 py-3 font-semibold">期間内 持出</th>
            <th className="px-3 py-3 font-semibold">期間内 返却</th>
            <th className="px-3 py-3 font-semibold">期間内 割合</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.employeeId}
              className={clsx('border-b border-white/5', row.openRiggingCount > 0 && 'bg-indigo-950/20')}
            >
              <td className="px-3 py-3 font-medium text-white">{row.displayName}</td>
              <td className="px-3 py-3 font-mono text-slate-200">{row.employeeCode}</td>
              <td className="px-3 py-3 tabular-nums">
                {row.openRiggingCount > 0 ? (
                  <span className="rounded-md bg-indigo-500/25 px-2 py-1 text-indigo-100">{row.openRiggingCount}</span>
                ) : (
                  <span className="text-white/45">0</span>
                )}
              </td>
              <td className="px-3 py-3 tabular-nums text-emerald-200">{row.periodBorrowCount}</td>
              <td className="px-3 py-3 tabular-nums text-sky-200">{row.periodReturnCount}</td>
              <td className="px-3 py-3">
                <PeriodMixBar
                  borrow={row.periodBorrowCount}
                  ret={row.periodReturnCount}
                  ariaLabel={`${row.displayName} 期間内 持出${row.periodBorrowCount} 返却${row.periodReturnCount}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TabId = 'gear' | 'employee';

export function KioskRiggingAnalyticsPage() {
  const { data, isPending, isError, error, refetch } = useRiggingLoanAnalytics();
  const [tab, setTab] = useState<TabId>('gear');

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-lg text-white/70" role="status">
        読み込み中…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-lg text-red-200">データを取得できませんでした。</p>
        <p className="max-w-md text-sm text-white/60">{error instanceof Error ? error.message : '不明なエラー'}</p>
        <button
          type="button"
          className="rounded-lg bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
          onClick={() => void refetch()}
        >
          再試行
        </button>
      </div>
    );
  }

  const chartRows = data.monthlyTrend.map((t) => ({
    month: formatYearMonthJa(t.yearMonth),
    borrow: t.borrowCount,
    returned: t.returnCount
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">吊具 持出・返却 状況</h2>
        <p className="mt-1 text-sm text-white/60">
          集計期間: {new Date(data.meta.periodFrom).toLocaleDateString('ja-JP')} —{' '}
          {new Date(data.meta.periodTo).toLocaleDateString('ja-JP')}（TZ {data.meta.timeZone}） / 取消済みの記録は含みません
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3">
          <div className="text-xs font-medium text-white/55">貸出中（件）</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-amber-200">{data.summary.openLoanCount}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3">
          <div className="text-xs font-medium text-white/55">期限超過 未返却（件）</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-red-300">{data.summary.overdueOpenCount}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3">
          <div className="text-xs font-medium text-white/55">吊具台数（廃棄除く）</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-white">{data.summary.totalRiggingGearsActive}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3">
          <div className="text-xs font-medium text-white/55">期間内 持出（件）</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">{data.summary.periodBorrowCount}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3">
          <div className="text-xs font-medium text-white/55">期間内 返却（件）</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-sky-300">{data.summary.periodReturnCount}</div>
        </div>
      </div>

      <section className="flex min-h-[280px] flex-col rounded-xl border border-white/10 bg-slate-900/40 p-4">
        <h3 className="mb-2 text-lg font-semibold text-white">
          月別（直近 {data.meta.monthlyMonths} か月）: 持出と返却
        </h3>
        <div className="min-h-[220px] w-full flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" vertical={false} />
              <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: 'rgb(226 232 240)', fontWeight: 600 }}
                cursor={{ fill: 'rgba(255,255,255,0.06)' }}
              />
              <Legend wrapperStyle={{ paddingTop: 12 }} formatter={(v) => <span className="text-slate-200">{v}</span>} />
              <Bar
                name="持出"
                dataKey="borrow"
                fill="rgb(52 211 153)"
                radius={[6, 6, 0, 0]}
                maxBarSize={40}
                isAnimationActive={false}
              />
              <Bar
                name="返却"
                dataKey="returned"
                fill="rgb(125 211 252)"
                radius={[6, 6, 0, 0]}
                maxBarSize={40}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={clsx(
              'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
              tab === 'gear' ? 'bg-fuchsia-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'
            )}
            onClick={() => setTab('gear')}
          >
            吊具ごと
          </button>
          <button
            type="button"
            className={clsx(
              'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
              tab === 'employee' ? 'bg-fuchsia-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'
            )}
            onClick={() => setTab('employee')}
          >
            人ごと
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1" style={{ maxHeight: 'min(52vh, 640px)' }}>
          {tab === 'gear' ? (
            data.byGear.length === 0 ? (
              <p className="py-8 text-center text-white/55">吊具データがありません。</p>
            ) : (
              <GearTable rows={data.byGear} />
            )
          ) : data.byEmployee.length === 0 ? (
            <p className="py-8 text-center text-white/55">該当する従業員の記録がありません。</p>
          ) : (
            <EmployeeTable rows={data.byEmployee} />
          )}
        </div>
      </div>
    </div>
  );
}
