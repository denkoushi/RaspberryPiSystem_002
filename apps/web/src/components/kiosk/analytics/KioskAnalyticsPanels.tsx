import { useMemo, type CSSProperties, type ReactNode } from 'react';

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

/** ランキング行のバー高さ・行間（パネル間で統一） */
const RANK_BAR_HEIGHT_CLASS = 'h-3.5';
/** デザインプレビューと同じ帯の水平上限（無意味な全幅伸びを抑える） */
const RANK_BAR_TRACK_MAX_CLASS = 'min-w-[3.5rem] max-w-[10rem] flex-1';
/** 氏名・ラベル: 最大2行（プレビュー .panel--dense-list の意図に合わせる） */
const RANK_LABEL_CLASS = 'min-w-0 max-w-[13rem] break-words text-[11px] leading-snug line-clamp-2';

function formatAssetRowLabel(row: AssetRow): string {
  const code = row.code?.trim();
  const name = row.name?.trim() ?? '';
  if (code && name && code !== name) {
    return `${code} ${name}`;
  }
  return name || code || row.id;
}

function PanelBadge({ theme, children }: { theme: KioskAnalyticsTheme; children: string }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold"
      style={{
        background: 'rgba(249, 115, 22, 0.14)',
        color: theme.chartBorrow,
        borderRadius: theme.radius6
      }}
    >
      {children}
    </span>
  );
}

/**
 * パネル共通: 余白・タイトル・バッジ・スクロール領域を揃え、カード外寸のばらつきを抑える。
 */
function PanelFrame({
  theme,
  title,
  badge,
  toolbar,
  legend,
  children,
  footer,
  bodyScrollable = true
}: {
  theme: KioskAnalyticsTheme;
  title: string;
  badge?: string;
  toolbar?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** false のとき本文はスクロールせず中央配置向けに伸長（事象比パネル等） */
  bodyScrollable?: boolean;
}) {
  const body = bodyScrollable ? (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">{children}</div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">{children}</div>
  );

  return (
    <section
      className="flex h-full min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-3 py-2.5"
      style={{
        borderRadius: theme.radius8,
        border: `1px solid ${theme.border}`,
        backgroundColor: theme.surface
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <h3 className="min-w-0 text-xs font-bold leading-snug" style={{ color: theme.textMuted }}>
          {title}
        </h3>
        {badge ? <PanelBadge theme={theme}>{badge}</PanelBadge> : null}
      </div>
      {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
      {legend ? <div className="shrink-0">{legend}</div> : null}
      {body}
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </section>
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
  const maxActivity = useMemo(() => Math.max(1, ...rows.map((r) => r.periodBorrowCount + r.periodReturnCount)), [rows]);

  const legend = (
    <div className="flex flex-wrap items-center gap-3 text-[10px]" style={{ color: theme.textSub }}>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.chartBorrow }} />
        持出
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.chartReturn }} />
        返却
      </span>
    </div>
  );

  return (
    <PanelFrame theme={theme} title="社員別 持出・返却" badge={rankBadge} legend={legend}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: theme.textSub }}>
          データがありません。
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 pr-0.5">
          {rows.map((row, idx) => {
            const br = row.periodBorrowCount;
            const rt = row.periodReturnCount;
            const sum = br + rt;
            const magnitudeWidth = `${Math.max(4, Math.round((sum / maxActivity) * 100))}%`;
            return (
              <li key={row.employeeId}>
                <div className="flex min-w-0 items-start gap-1.5">
                  <span
                    className="mt-0.5 w-[22px] shrink-0 text-center text-[11px] font-bold tabular-nums"
                    style={{ color: idx < 3 ? 'var(--color-primitive-amber-400, #fbbf24)' : theme.textSub }}
                  >
                    {idx + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className={`${RANK_LABEL_CLASS} font-medium`} style={{ color: theme.textSub }} title={row.displayName}>
                      {row.displayName}
                    </span>
                    <div
                      className={`${RANK_BAR_HEIGHT_CLASS} ${RANK_BAR_TRACK_MAX_CLASS} overflow-hidden rounded-sm`}
                      style={{ background: 'rgba(255,255,255,0.06)' }}
                      aria-hidden
                    >
                      {sum === 0 ? null : (
                        <div className="flex h-full min-w-0 overflow-hidden rounded-sm" style={{ width: magnitudeWidth }}>
                          <div
                            className="min-h-0 min-w-[2px] shrink"
                            style={{
                              flexGrow: br,
                              flexBasis: 0,
                              backgroundColor: theme.chartBorrow
                            }}
                          />
                          <div
                            className="min-h-0 min-w-[2px] shrink"
                            style={{
                              flexGrow: rt,
                              flexBasis: 0,
                              backgroundColor: theme.chartReturn
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0 text-[10px] tabular-nums leading-none">
                      <span style={{ color: theme.chartBorrow }}>{br}</span>
                      <span style={{ color: theme.chartReturn }}>{rt}</span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PanelFrame>
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
        <strong className="tabular-nums" style={{ color: theme.text }}>
          {summary.availableCount}
        </strong>
        <span style={{ color: theme.textSub }}>利用可</span>
      </span>
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
        style={{ border: `1px solid ${theme.borderSubtle}`, background: 'rgba(255,255,255,0.04)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-primitive-yellow-300)' }} />
        <strong className="tabular-nums" style={{ color: theme.text }}>
          {summary.inUseCount}
        </strong>
        <span style={{ color: theme.textSub }}>貸出中</span>
      </span>
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
        style={{ border: `1px solid ${theme.borderSubtle}`, background: 'rgba(255,255,255,0.04)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: theme.error }} />
        <strong className="tabular-nums" style={{ color: theme.text }}>
          {summary.overdueCount}
        </strong>
        <span style={{ color: theme.textSub }}>超過</span>
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
    <PanelFrame
      theme={theme}
      title={title}
      badge={rankBadge}
      legend={inventory ? <AssetInventoryChips summary={inventory} theme={theme} /> : undefined}
    >
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: theme.textSub }}>
          データがありません。
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 pr-0.5">
          {sorted.map((row, idx) => (
            <li key={row.id}>
              <div className="flex min-w-0 items-start gap-1.5">
                <span
                  className="mt-0.5 w-[22px] shrink-0 text-center text-[11px] font-bold tabular-nums"
                  style={{ color: idx < 3 ? 'var(--color-primitive-amber-400, #fbbf24)' : theme.textSub }}
                >
                  {idx + 1}
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={RANK_LABEL_CLASS} style={{ color: theme.textSub }} title={formatAssetRowLabel(row)}>
                    {formatAssetRowLabel(row)}
                  </span>
                  <div
                    className={`${RANK_BAR_HEIGHT_CLASS} ${RANK_BAR_TRACK_MAX_CLASS} rounded-sm`}
                    style={{
                      background: 'rgba(255,255,255,0.06)'
                    }}
                  >
                    <div
                      className={`${RANK_BAR_HEIGHT_CLASS} min-w-0 rounded-sm`}
                      style={{
                        width: `${(row.periodBorrowCount / maxValue) * 100}%`,
                        backgroundColor: theme.chartBorrow
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: theme.chartBorrow }}>
                    {row.periodBorrowCount}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
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
    <PanelFrame theme={theme} title={title} bodyScrollable={false}>
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
    </PanelFrame>
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
  captionBadge?: string;
  todaySummary?: TodayEventsSummary | null;
}) {
  const badge = captionBadge;

  const toolbar =
    todaySummary === undefined || todaySummary === null ? null : (
      <div className="grid grid-cols-3 gap-1.5">
        <MiniTodayKpi label="今日の持出" value={todaySummary.borrowCount} accent={theme.chartBorrow} theme={theme} />
        <MiniTodayKpi label="今日の返却" value={todaySummary.returnCount} accent={theme.chartReturn} theme={theme} />
        <MiniTodayKpi
          label="当日返却率"
          value={todaySummary.returnCompletionPercent === null ? '—' : `${todaySummary.returnCompletionPercent}%`}
          accent="var(--color-semantic-success-1, #34d399)"
          theme={theme}
        />
      </div>
    );

  return (
    <PanelFrame theme={theme} title={title} badge={badge} toolbar={toolbar}>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md" style={{ border: `1px solid ${theme.border}` }}>
        <table className="w-full min-w-0 table-fixed text-left" style={tableDense}>
          <thead
            className="sticky top-0 z-10"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 96%, transparent)' }}
          >
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              <th className="px-2 py-1 text-[11px]" style={{ color: theme.textMuted, fontWeight: 700 }}>
                時刻
              </th>
              <th className="px-2 py-1 text-[11px]" style={{ color: theme.textMuted, fontWeight: 700 }}>
                種別
              </th>
              <th className="px-2 py-1 text-[11px]" style={{ color: theme.textMuted, fontWeight: 700 }}>
                資産
              </th>
              <th className="px-2 py-1 text-[11px]" style={{ color: theme.textMuted, fontWeight: 700 }}>
                社員
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-xs" style={{ color: theme.textSub }}>
                  当日のイベントはありません。
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={`${row.kind}-${row.assetId}-${row.eventAt}`}
                  className="border-b"
                  style={{ borderColor: 'var(--color-neutral-opacity-gray-100)' }}
                >
                  <td className="w-[68px] px-2 py-1 text-[13px] tabular-nums" style={{ color: theme.textSub }}>
                    {formatDateTimeJa(row.eventAt)}
                  </td>
                  <td className="w-[44px] px-2 py-1 text-[13px] font-bold" style={{ color: row.kind === 'BORROW' ? theme.chartBorrow : theme.chartReturn }}>
                    {row.kind === 'BORROW' ? '持出' : '返却'}
                  </td>
                  <td className="truncate px-2 py-1 text-[13px]" style={{ color: theme.text }}>
                    {row.assetLabel}
                  </td>
                  <td className="w-[88px] truncate px-2 py-1 text-[13px]" style={{ color: theme.textSub }}>
                    {row.actorDisplayName ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PanelFrame>
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
      className="flex min-h-[52px] flex-col items-center justify-center rounded px-1 py-1.5"
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
