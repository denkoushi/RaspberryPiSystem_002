import { useMemo, type CSSProperties } from 'react';

import { formatDateTimeJa } from '../../../features/kiosk-loan-analytics/period';

import type { KioskAnalyticsTheme } from './kioskAnalyticsTheme';
import type { AssetInventorySummary } from '../../../features/kiosk-loan-analytics/analyticsDisplayPolicy';
import type { AssetRow, EmployeeRow, PeriodEventRow } from '../../../features/kiosk-loan-analytics/view-model';

export type { KioskAnalyticsTheme } from './kioskAnalyticsTheme';

const tableDense: CSSProperties = {
  fontSize: 'var(--font-size-14)',
  lineHeight: 'var(--line-height-130)',
  fontFamily: 'var(--font-family-sans)'
};

function PanelBadge({ theme, children }: { theme: KioskAnalyticsTheme; children: string }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold"
      style={{
        background: 'rgba(59, 130, 246, 0.12)',
        color: theme.chartBorrow,
        borderRadius: theme.radius6
      }}
    >
      {children}
    </span>
  );
}

export function EmployeeBarsPanel({
  rows,
  theme,
  rankBadge
}: {
  rows: EmployeeRow[];
  theme: KioskAnalyticsTheme;
  rankBadge?: string;
}) {
  const maxValue = useMemo(() => Math.max(1, ...rows.map((r) => Math.max(r.periodBorrowCount, r.periodReturnCount))), [rows]);
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-1 p-2"
      style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface }}
    >
      <div className="flex min-h-0 items-center justify-between gap-2">
        <h3 className="shrink-0 text-xs font-bold" style={{ color: theme.textMuted }}>
          社員別 持出・返却
        </h3>
        {rankBadge ? <PanelBadge theme={theme}>{rankBadge}</PanelBadge> : null}
      </div>
      <div className="flex items-center gap-3 text-[10px]" style={{ color: theme.textSub }}>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.chartBorrow }} />
          持出
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.chartReturn }} />
          返却
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-0.5">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-xs" style={{ color: theme.textSub }}>
            データがありません。
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.employeeId} className="grid grid-cols-[minmax(0,94px)_1fr] items-center gap-1 py-0.5">
              <span className="truncate text-[11px] font-medium" style={{ color: theme.textSub }}>
                {row.displayName}
              </span>
              <div className="space-y-0.5">
                <div className="flex min-w-0 items-center gap-1">
                  <div
                    className="h-1.5 min-w-0 rounded-sm"
                    style={{
                      width: `${(row.periodBorrowCount / maxValue) * 100}%`,
                      backgroundColor: theme.chartBorrow
                    }}
                  />
                  <span className="shrink-0 text-[10px] tabular-nums" style={{ color: theme.textMuted }}>
                    {row.periodBorrowCount}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <div
                    className="h-1.5 min-w-0 rounded-sm"
                    style={{
                      width: `${(row.periodReturnCount / maxValue) * 100}%`,
                      backgroundColor: theme.chartReturn
                    }}
                  />
                  <span className="shrink-0 text-[10px] tabular-nums" style={{ color: theme.textMuted }}>
                    {row.periodReturnCount}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** 在庫チップ（資産タブ用） */
export function AssetInventoryChips({ summary, theme }: { summary: AssetInventorySummary; theme: KioskAnalyticsTheme }) {
  return (
    <div className="flex flex-wrap gap-1 text-[10px]" aria-label="資産状態の件数">
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
        style={{ border: `1px solid ${theme.borderSubtle}`, background: 'rgba(255,255,255,0.04)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-semantic-success-1, #34d399)' }} />
        <span style={{ color: theme.textSub }}>利用可</span>
        <strong className="tabular-nums" style={{ color: theme.text }}>
          {summary.availableCount}
        </strong>
      </span>
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
        style={{ border: `1px solid ${theme.borderSubtle}`, background: 'rgba(255,255,255,0.04)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-primitive-yellow-300)' }} />
        <span style={{ color: theme.textSub }}>貸出中</span>
        <strong className="tabular-nums" style={{ color: theme.text }}>
          {summary.inUseCount}
        </strong>
      </span>
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
        style={{ border: `1px solid ${theme.borderSubtle}`, background: 'rgba(255,255,255,0.04)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: theme.error }} />
        <span style={{ color: theme.textSub }}>超過</span>
        <strong className="tabular-nums" style={{ color: theme.text }}>
          {summary.overdueCount}
        </strong>
      </span>
    </div>
  );
}

export function AssetBorrowFrequencyPanel({
  rows,
  theme,
  title,
  rankBadge,
  inventory
}: {
  rows: AssetRow[];
  theme: KioskAnalyticsTheme;
  title: string;
  rankBadge?: string;
  inventory?: AssetInventorySummary | null;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.periodBorrowCount - a.periodBorrowCount), [rows]);
  const maxValue = Math.max(1, ...sorted.map((r) => r.periodBorrowCount));
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-1 p-2"
      style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface }}
    >
      <div className="flex min-h-0 items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-xs font-bold" style={{ color: theme.textMuted }}>
          {title}
        </h3>
        {rankBadge ? <PanelBadge theme={theme}>{rankBadge}</PanelBadge> : null}
      </div>
      {inventory ? <AssetInventoryChips summary={inventory} theme={theme} /> : null}
      <div className="flex min-h-0 flex-1 flex-col justify-between gap-0.5">
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-xs" style={{ color: theme.textSub }}>
            データがありません。
          </p>
        ) : (
          sorted.map((row) => (
            <div key={row.id} className="grid grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-1 py-0.5">
              <span className="truncate text-[11px]" style={{ color: theme.textSub }}>
                {row.name}
              </span>
              <div
                className="h-2 min-w-0 rounded-sm"
                style={{
                  width: `${(row.periodBorrowCount / maxValue) * 100}%`,
                  backgroundColor: theme.chartBorrow
                }}
              />
              <span className="shrink-0 text-[10px] tabular-nums" style={{ color: theme.textMuted }}>
                {row.periodBorrowCount}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function ReturnRatePanel({
  borrow,
  ret,
  theme,
  title,
  footerNote
}: {
  borrow: number;
  ret: number;
  theme: KioskAnalyticsTheme;
  title: string;
  footerNote?: string;
}) {
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
      className="flex min-h-0 flex-1 flex-col gap-1 p-2"
      style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface }}
    >
      <h3 className="text-xs font-bold" style={{ color: theme.textMuted }}>
        {title}
      </h3>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
        <div className="flex flex-1 flex-wrap items-center justify-center gap-4">
          <svg viewBox="0 0 80 80" className="h-24 w-24 shrink-0" aria-label="持出と返却の件数比の円グラフ">
            <title>
              持出 {borrow} 件、返却 {ret} 件の比
            </title>
            <path d={`M${cx},${cy} L${p1.x},${p1.y} A${radius},${radius} 0 ${largeBorrow} 1 ${p2.x},${p2.y} Z`} fill={theme.chartBorrow} />
            <path
              d={`M${cx},${cy} L${p2.x},${p2.y} A${radius},${radius} 0 ${largeRet} 1 ${p3.x},${p3.y} Z`}
              fill={theme.chartReturn}
            />
            <circle cx={cx} cy={cy} r="14" fill="var(--color-neutral-solid-gray-800)" />
          </svg>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.chartBorrow }} />
              <span style={{ color: theme.textSub }}>持出事象</span>
              <strong className="tabular-nums" style={{ color: theme.text }}>
                {borrowPct}%
              </strong>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.chartReturn }} />
              <span style={{ color: theme.textSub }}>返却事象</span>
              <strong className="tabular-nums" style={{ color: theme.text }}>
                {retPct}%
              </strong>
            </div>
          </div>
        </div>
        {footerNote ? (
          <p className="w-full text-center text-[10px] leading-tight" style={{ color: theme.textSub }}>
            {footerNote}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export type TodayEventsSummary = {
  borrowCount: number;
  returnCount: number;
  /** 当日の返却÷持出（%）。持出0なら null */
  returnCompletionPercent: number | null;
};

export function TodayEventsPane({
  rows,
  theme,
  title,
  captionBadge,
  todaySummary
}: {
  rows: PeriodEventRow[];
  theme: KioskAnalyticsTheme;
  title: string;
  /** 例: 「直近 5 件」（呼び出し側で表示上限に合わせたラベル） */
  captionBadge?: string;
  todaySummary?: TodayEventsSummary | null;
}) {
  const visible = rows;
  const badge = captionBadge;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-1"
      style={{ borderRadius: theme.radius8, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, padding: '8px' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold" style={{ color: theme.textMuted }}>
          {title}
        </h3>
        {badge ? <PanelBadge theme={theme}>{badge}</PanelBadge> : null}
      </div>

      {todaySummary ? (
        <div className="grid grid-cols-3 gap-1">
          <MiniTodayKpi label="今日の持出" value={todaySummary.borrowCount} accent={theme.chartBorrow} theme={theme} />
          <MiniTodayKpi label="今日の返却" value={todaySummary.returnCount} accent={theme.chartReturn} theme={theme} />
          <MiniTodayKpi
            label="当日返却率"
            value={todaySummary.returnCompletionPercent === null ? '—' : `${todaySummary.returnCompletionPercent}%`}
            accent="var(--color-semantic-success-1, #34d399)"
            theme={theme}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded" style={{ border: `1px solid ${theme.border}` }}>
        <table className="w-full min-w-0 table-fixed text-left" style={tableDense}>
          <thead
            className="sticky top-0 z-10 backdrop-blur"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)' }}
          >
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              <th className="px-2 py-1.5" style={{ color: theme.textMuted, fontWeight: 700 }}>
                時刻
              </th>
              <th className="px-2 py-1.5" style={{ color: theme.textMuted, fontWeight: 700 }}>
                種別
              </th>
              <th className="px-2 py-1.5" style={{ color: theme.textMuted, fontWeight: 700 }}>
                資産
              </th>
              <th className="px-2 py-1.5" style={{ color: theme.textMuted, fontWeight: 700 }}>
                社員
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-xs" style={{ color: theme.textSub }}>
                  当日のイベントはありません。
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={`${row.kind}-${row.assetId}-${row.eventAt}`} className="border-b" style={{ borderColor: 'var(--color-neutral-opacity-gray-100)' }}>
                  <td className="w-[68px] px-2 py-1 tabular-nums" style={{ color: theme.textSub }}>
                    {formatDateTimeJa(row.eventAt)}
                  </td>
                  <td className="w-[44px] px-2 py-1 font-bold" style={{ color: row.kind === 'BORROW' ? theme.chartBorrow : theme.chartReturn }}>
                    {row.kind === 'BORROW' ? '持出' : '返却'}
                  </td>
                  <td className="truncate px-2 py-1" style={{ color: theme.text }}>
                    {row.assetLabel}
                  </td>
                  <td className="w-[88px] truncate px-2 py-1" style={{ color: theme.textSub }}>
                    {row.actorDisplayName ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MiniTodayKpi({
  theme,
  label,
  value,
  accent
}: {
  theme: KioskAnalyticsTheme;
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded px-1 py-1.5"
      style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${theme.borderSubtle}` }}
    >
      <span className="text-[9px]" style={{ color: theme.textSub }}>
        {label}
      </span>
      <span className="text-lg font-extrabold tabular-nums leading-tight" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

