import type { ViewModel } from '../../../features/kiosk-loan-analytics/view-model';
import type { ReactNode } from 'react';

export function KioskAnalyticsKpiStrip({
  view, periodLabel, availableCount, longestOverdue, borrowChangePercent, returnCompletionPercent
}: {
  view: ViewModel;
  periodLabel: string;
  availableCount: number | null;
  longestOverdue: number | null;
  borrowChangePercent: number | null;
  returnCompletionPercent: number | null;
}) {
  const utilization = view.totalMasterCount > 0 ? Math.min(100, view.openLoanCount / view.totalMasterCount * 100) : 0;
  const trend = view.monthlyTrend.slice(-6);
  const maxCount = Math.max(1, ...trend.flatMap((row) => [row.borrowCount, row.returnCount]));
  return (
    <div className="kanalytics__hero" role="region" aria-label="期間サマリー指標">
      <KpiCard label="貸出中" value={view.openLoanCount} suffix={`/ ${view.totalMasterCount}台`}>
        <span className="kanalytics__meter" role="meter" aria-label="利用率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(utilization)}>
          <i style={{ width: `${utilization}%` }} />
        </span>
        {availableCount !== null && <span>空き {availableCount}</span>}
      </KpiCard>
      <KpiCard label="期限超過" value={view.overdueOpenCount} suffix="件" tone={view.overdueOpenCount > 0 ? 'alert' : 'calm'}>
        {view.overdueOpenCount === 0 ? 'すべて期限内' : longestOverdue !== null ? `最長 ${longestOverdue}日` : null}
      </KpiCard>
      <KpiCard label={`${periodLabel} 持出`} value={view.periodBorrowCount} suffix="件">
        {borrowChangePercent !== null && <><span className={borrowChangePercent >= 0 ? 'kanalytics__up' : 'kanalytics__down'}>{borrowChangePercent >= 0 ? '▲' : '▼'} {Math.abs(borrowChangePercent)}%</span><span>前月比</span></>}
      </KpiCard>
      <KpiCard label={`${periodLabel} 返却`} value={view.periodReturnCount} suffix="件">
        返却率 {returnCompletionPercent === null ? '—' : `${returnCompletionPercent}%`}
      </KpiCard>
      <div className="kanalytics__tile">
        <div className="kanalytics__head">
          <h3>6か月の推移</h3>
          <div className="kanalytics__legend"><span><i className="kanalytics__bar-borrow" />持出</span><span><i className="kanalytics__bar-return" />返却</span></div>
        </div>
        {trend.length === 0 ? <p className="kanalytics__empty">データなし</p> : (
          <div className="kanalytics__trend" role="img" aria-label={trend.map((row) => `${row.yearMonth} 持出 ${row.borrowCount}件、返却 ${row.returnCount}件`).join('；')}>
            {trend.map((row) => (
              <div className="kanalytics__month" key={row.yearMonth} aria-hidden="true">
                <div className="kanalytics__pair">
                  <i className="kanalytics__bar-borrow" style={{ height: `${row.borrowCount / maxCount * 84}px` }} />
                  <i className="kanalytics__bar-return" style={{ height: `${row.returnCount / maxCount * 84}px` }} />
                </div>
                <span>{Number(row.yearMonth.slice(5))}月</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, suffix, tone, children }: { label: string; value: number; suffix: string; tone?: 'alert' | 'calm'; children: ReactNode }) {
  return (
    <div className={`kanalytics__tile${tone ? ` kanalytics__tile--${tone}` : ''}`}>
      <h3>{label}</h3>
      <div className="kanalytics__big"><span>{value}</span><small>{suffix}</small></div>
      <div className="kanalytics__sub">{children}</div>
    </div>
  );
}
