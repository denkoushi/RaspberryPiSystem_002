import { useMemo, type CSSProperties } from 'react';

import { formatDateTimeJa } from '../../../features/kiosk-loan-analytics/period';

import type { AssetRow, EmployeeRow, PeriodEventRow } from '../../../features/kiosk-loan-analytics/view-model';

type Theme = {
  chartBorrow: string;
  chartReturn: string;
  strokeBar: string;
  surface: string;
  border: string;
  borderSubtle: string;
  text: string;
  textMuted: string;
  textSub: string;
  primaryUi: string;
  tabInactive: string;
  error: string;
  radius8: string;
  radius6: string;
};

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: '利用可',
  IN_USE: '貸出中',
  MAINTENANCE: '整備',
  RETIRED: '廃棄'
};

const tableDense: CSSProperties = {
  fontSize: 'var(--font-size-14)',
  lineHeight: 'var(--line-height-130)',
  fontFamily: 'var(--font-family-sans)'
};

const monoCell: CSSProperties = { fontFamily: 'var(--font-family-mono)' };

function BorrowReturnMixCell({
  borrow,
  ret,
  ariaLabel,
  theme
}: {
  borrow: number;
  ret: number;
  ariaLabel: string;
  theme: Theme;
}) {
  const sum = borrow + ret;
  if (sum <= 0) {
    return (
      <span className="text-[11px] tabular-nums" style={{ color: theme.textSub }} aria-label={ariaLabel}>
        —
      </span>
    );
  }
  const borrowPct = Math.round((borrow / sum) * 100);
  const returnPct = Math.max(0, Math.min(100, 100 - borrowPct));
  const title = `持出 ${borrow} 件（${borrowPct}%） / 返却 ${ret} 件（${returnPct}%）`;
  return (
    <div
      className="h-2.5 w-full min-w-[72px] max-w-[120px] overflow-hidden"
      style={{
        borderRadius: 'var(--border-radius-4)',
        border: `1px solid ${theme.border}`,
        backgroundColor: 'var(--color-neutral-solid-gray-900)'
      }}
      title={title}
      aria-label={`${ariaLabel}。${title}`}
    >
      <div className="flex h-full w-full">
        <div className="h-full shrink-0" style={{ width: `${(borrow / sum) * 100}%`, backgroundColor: theme.chartBorrow }} />
        <div
          className="h-full shrink-0"
          style={{ width: `${(ret / sum) * 100}%`, backgroundColor: theme.chartReturn, borderLeft: `1px solid ${theme.strokeBar}` }}
        />
      </div>
    </div>
  );
}

export function EmployeeBarsPanel({ rows, theme }: { rows: EmployeeRow[]; theme: Theme }) {
  const maxValue = useMemo(() => Math.max(1, ...rows.map((r) => Math.max(r.periodBorrowCount, r.periodReturnCount))), [rows]);
  return (
    <section
      className="flex min-h-0 flex-col gap-1 p-2"
      style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface }}
    >
      <h3 className="text-xs font-bold" style={{ color: theme.textMuted }}>
        返却回数
      </h3>
      <div className="flex items-center gap-3 text-[10px]" style={{ color: theme.textSub }}>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.chartBorrow }} />持出</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.chartReturn }} />返却</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {rows.map((row) => (
          <div key={row.employeeId} className="grid grid-cols-[94px_1fr] items-center gap-1 py-0.5">
            <span className="truncate text-[11px] font-medium" style={{ color: theme.textSub }}>
              {row.displayName}
            </span>
            <div className="space-y-0.5">
              <div className="flex items-center gap-1">
                <div className="h-1.5 rounded-sm" style={{ width: `${(row.periodBorrowCount / maxValue) * 100}%`, backgroundColor: theme.chartBorrow }} />
                <span className="text-[10px] tabular-nums" style={{ color: theme.textMuted }}>{row.periodBorrowCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-1.5 rounded-sm" style={{ width: `${(row.periodReturnCount / maxValue) * 100}%`, backgroundColor: theme.chartReturn }} />
                <span className="text-[10px] tabular-nums" style={{ color: theme.textMuted }}>{row.periodReturnCount}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AssetBorrowFrequencyPanel({ rows, theme, title }: { rows: AssetRow[]; theme: Theme; title: string }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.periodBorrowCount - a.periodBorrowCount), [rows]);
  const maxValue = Math.max(1, ...sorted.map((r) => r.periodBorrowCount));
  return (
    <section
      className="flex min-h-0 flex-col gap-1 p-2"
      style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface }}
    >
      <h3 className="text-xs font-bold" style={{ color: theme.textMuted }}>{title}</h3>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {sorted.map((row) => (
          <div key={row.id} className="grid grid-cols-[150px_1fr_auto] items-center gap-1 py-0.5">
            <span className="truncate text-[11px]" style={{ color: theme.textSub }}>{row.name}</span>
            <div className="h-2 rounded-sm" style={{ width: `${(row.periodBorrowCount / maxValue) * 100}%`, backgroundColor: theme.chartBorrow }} />
            <span className="text-[10px] tabular-nums" style={{ color: theme.textMuted }}>{row.periodBorrowCount}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReturnRatePanel({ borrow, ret, theme, title }: { borrow: number; ret: number; theme: Theme; title: string }) {
  const total = Math.max(1, borrow + ret);
  const borrowPct = Math.round((borrow / total) * 100);
  const retPct = 100 - borrowPct;
  const angle = (borrow / total) * 360;
  const radius = 34;
  const cx = 40;
  const cy = 40;
  const toPt = (deg: number) => {
    const r = ((deg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(r), y: cy + radius * Math.sin(r) };
  };
  const p1 = toPt(0);
  const p2 = toPt(angle);
  const p3 = toPt(360);
  const largeBorrow = angle > 180 ? 1 : 0;
  const largeRet = 360 - angle > 180 ? 1 : 0;
  return (
    <section
      className="flex min-h-[180px] flex-col gap-1 p-2"
      style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface }}
    >
      <h3 className="text-xs font-bold" style={{ color: theme.textMuted }}>{title}</h3>
      <div className="flex flex-1 items-center justify-center gap-5">
        <svg viewBox="0 0 80 80" className="h-28 w-28" aria-label="返却率円グラフ">
          <path d={`M${cx},${cy} L${p1.x},${p1.y} A${radius},${radius} 0 ${largeBorrow} 1 ${p2.x},${p2.y} Z`} fill={theme.chartBorrow} />
          <path d={`M${cx},${cy} L${p2.x},${p2.y} A${radius},${radius} 0 ${largeRet} 1 ${p3.x},${p3.y} Z`} fill={theme.chartReturn} />
          <circle cx={cx} cy={cy} r="14" fill="var(--color-neutral-solid-gray-800)" />
        </svg>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.chartBorrow }} />
            <span style={{ color: theme.textSub }}>持出</span>
            <strong className="tabular-nums" style={{ color: theme.text }}>{borrowPct}%</strong>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.chartReturn }} />
            <span style={{ color: theme.textSub }}>返却</span>
            <strong className="tabular-nums" style={{ color: theme.text }}>{retPct}%</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

export function UsageTablePanel({
  rows,
  theme,
  title
}: {
  rows: AssetRow[];
  theme: Theme;
  title: string;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.periodBorrowCount - a.periodBorrowCount), [rows]);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1">
      <h3 className="text-xs font-bold" style={{ color: theme.textMuted }}>{title}</h3>
      <div className="min-h-0 flex-1 overflow-x-auto" style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}` }}>
        <table className="w-full min-w-[560px] text-left" style={tableDense}>
          <thead
            className="sticky top-0 z-10 backdrop-blur"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)' }}
          >
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>回数</th>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>名称</th>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>管理番号</th>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>状態</th>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>借用者</th>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>内訳</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} className="border-b" style={{ borderColor: 'var(--color-neutral-opacity-gray-100)' }}>
                <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: theme.chartBorrow }}>{row.periodBorrowCount}</td>
                <td className="px-2 py-1.5 font-medium" style={{ color: theme.text }}>{row.name}</td>
                <td className="px-2 py-1.5 tabular-nums" style={{ ...monoCell, color: theme.textSub }}>{row.code}</td>
                <td className="px-2 py-1.5" style={{ color: theme.textMuted }}>{STATUS_LABEL[row.status] ?? row.status}</td>
                <td className="px-2 py-1.5" style={{ color: theme.text }}>{row.currentBorrowerDisplayName ?? '—'}</td>
                <td className="px-2 py-1.5">
                  <BorrowReturnMixCell
                    borrow={row.periodBorrowCount}
                    ret={row.periodReturnCount}
                    ariaLabel={`${row.name} 持出${row.periodBorrowCount} 返却${row.periodReturnCount}`}
                    theme={theme}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TodayEventsPane({
  rows,
  theme,
  title
}: {
  rows: PeriodEventRow[];
  theme: Theme;
  title: string;
}) {
  return (
    <section className="flex min-h-[220px] flex-col gap-1 border-t pt-2" style={{ borderColor: theme.border }}>
      <h3 className="text-xs font-bold" style={{ color: theme.textMuted }}>{title}</h3>
      <div className="min-h-0 flex-1 overflow-x-auto" style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}` }}>
        <table className="w-full min-w-[540px] text-left" style={tableDense}>
          <thead
            className="sticky top-0 z-10 backdrop-blur"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)' }}
          >
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>時刻</th>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>種別</th>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>資産</th>
              <th className="px-2 py-2" style={{ color: theme.textMuted, fontWeight: 700 }}>社員</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-2 py-5 text-center text-sm" style={{ color: theme.textSub }}>当日のイベントはありません。</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.kind}-${row.assetId}-${row.eventAt}`} className="border-b" style={{ borderColor: 'var(--color-neutral-opacity-gray-100)' }}>
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: theme.textSub }}>{formatDateTimeJa(row.eventAt)}</td>
                  <td className="px-2 py-1.5 font-bold" style={{ color: row.kind === 'BORROW' ? theme.chartBorrow : theme.chartReturn }}>
                    {row.kind === 'BORROW' ? '持出' : '返却'}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: theme.text }}>{row.assetLabel}</td>
                  <td className="px-2 py-1.5" style={{ color: theme.textSub }}>{row.actorDisplayName ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
