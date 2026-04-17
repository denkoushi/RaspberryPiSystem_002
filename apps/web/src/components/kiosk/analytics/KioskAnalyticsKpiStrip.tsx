import type { KioskAnalyticsTheme } from './kioskAnalyticsTheme';

export type KioskAnalyticsKpiStripProps = {
  theme: KioskAnalyticsTheme;
  openLoanCount: number;
  overdueOpenCount: number;
  totalMasterCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
  /** 返却件数÷持出件数（%）。持出0のときは null。 */
  returnCompletionPercent: number | null;
};

/**
 * キオスク集計の主要指標を1行に集約（スクロール不要のダッシュ用）。
 */
export function KioskAnalyticsKpiStrip({
  theme,
  openLoanCount,
  overdueOpenCount,
  totalMasterCount,
  periodBorrowCount,
  periodReturnCount,
  returnCompletionPercent
}: KioskAnalyticsKpiStripProps) {
  return (
    <div
      className="grid shrink-0 grid-cols-2 gap-1.5 min-[920px]:grid-cols-5"
      role="region"
      aria-label="期間サマリー指標"
      style={{ fontFamily: 'var(--font-family-sans)' }}
    >
      <KpiCard
        label="貸出中"
        value={openLoanCount}
        subLabel={`/ 全${totalMasterCount}台`}
        valueColor="var(--color-primitive-yellow-300)"
        theme={theme}
      />
      <KpiCard label="超過" value={overdueOpenCount} subLabel="要対応" valueColor={theme.error} theme={theme} />
      <KpiCard label="今月 持出" value={periodBorrowCount} subLabel="件" valueColor={theme.chartBorrow} theme={theme} />
      <KpiCard label="今月 返却" value={periodReturnCount} subLabel="件" valueColor={theme.chartReturn} theme={theme} />
      <KpiCard
        label="返却率"
        value={returnCompletionPercent === null ? '—' : `${returnCompletionPercent}`}
        subLabel={returnCompletionPercent === null ? '対象期間の持出0件' : '返却÷持出'}
        valueColor="var(--color-semantic-success-1, var(--color-primitive-green-300, #86efac))"
        theme={theme}
        largeSuffix={returnCompletionPercent !== null ? '%' : undefined}
      />
    </div>
  );
}

function KpiCard({
  theme,
  label,
  value,
  subLabel,
  valueColor,
  largeSuffix
}: {
  theme: KioskAnalyticsTheme;
  label: string;
  value: number | string;
  subLabel: string;
  valueColor: string;
  largeSuffix?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-0.5 py-2.5 px-2"
      style={{
        borderRadius: theme.radius8,
        border: `1px solid ${theme.border}`,
        backgroundColor: theme.surface
      }}
    >
      <span className="text-[10px] tracking-wide" style={{ color: theme.textSub }}>
        {label}
      </span>
      <span className="flex items-baseline gap-0.5 tabular-nums">
        <strong className="text-2xl font-extrabold leading-none" style={{ color: valueColor }}>
          {value}
        </strong>
        {largeSuffix ? (
          <span className="text-sm font-bold" style={{ color: valueColor }}>
            {largeSuffix}
          </span>
        ) : null}
      </span>
      <span className="text-[9px]" style={{ color: theme.textSub }}>
        {subLabel}
      </span>
    </div>
  );
}
