import { formatAssetRowLabel } from '../../../features/kiosk-loan-analytics/analyticsDisplayPolicy';

import type { AnalyticsListMode } from '../../../features/kiosk-loan-analytics/analyticsDisplayPolicy';
import type { AssetRow, EmployeeRow, PeriodEventRow } from '../../../features/kiosk-loan-analytics/view-model';
import type { ReactNode } from 'react';

export type OpenLoanDisplayRow = AssetRow & { dueLabel: string };
export type TodayEventDisplayRow = PeriodEventRow & { timeLabel: string };

function PanelFrame({ title, header, children }: { title: string; header: ReactNode; children: ReactNode }) {
  return (
    <section className="kanalytics__panel" aria-label={title}>
      <header><h2>{title}</h2>{header}</header>
      {children}
    </section>
  );
}

function listClass(mode: AnalyticsListMode, kind: string): string {
  return `kanalytics__list kanalytics__${kind}${mode === 'all' ? ' kanalytics__list--all' : ''}`;
}

function AssetLabel({ row }: { row: AssetRow }) {
  const code = row.code.trim();
  const name = row.name.trim();
  return (
    <span className="kanalytics__t1 kanalytics__name" title={formatAssetRowLabel(row)}>
      {code && name && code !== name ? <><span className="kanalytics__code">{code}</span>{' '}{name}</> : formatAssetRowLabel(row)}
    </span>
  );
}

export function OpenLoansPanel({ rows, openCount, overdueCount, remainingCount, mode }: {
  rows: OpenLoanDisplayRow[];
  openCount: number;
  overdueCount: number;
  remainingCount: number;
  mode: AnalyticsListMode;
}) {
  return (
    <PanelFrame title="未返却" header={<>
      <span className="kanalytics__count">{openCount}</span>
      {overdueCount > 0 && <span className="kanalytics__chip kanalytics__chip--alert">超過 {overdueCount}</span>}
      <div className="kanalytics__right">期限の早い順</div>
    </>}>
      {rows.length === 0 ? <p className="kanalytics__empty">未返却なし</p> : (
        <ul className={listClass(mode, 'open')}>
          {rows.map((row) => (
            <li key={row.id} className={row.openIsOverdue ? 'kanalytics__over' : undefined}>
              <span className="kanalytics__dot" aria-hidden="true" />
              <span className="kanalytics__who" title={row.currentBorrowerDisplayName ?? '—'}>{row.currentBorrowerDisplayName ?? '—'}</span>
              <AssetLabel row={row} />
              <span className="kanalytics__due">{row.dueLabel}</span>
            </li>
          ))}
          {remainingCount > 0 && <li className="kanalytics__more">ほか {remainingCount} 件</li>}
        </ul>
      )}
    </PanelFrame>
  );
}

/** 全件モードの上限で切り詰めた分を知らせる行。 */
function MoreRow({ total, shown }: { total: number; shown: number }) {
  return total > shown ? <li className="kanalytics__more">ほか {total - shown} 件</li> : null;
}

export function EmployeeBarsPanel({ rows, mode, totalCount }: { rows: EmployeeRow[]; mode: AnalyticsListMode; totalCount: number }) {
  const maxActivity = Math.max(1, ...rows.map((row) => row.periodBorrowCount + row.periodReturnCount));
  return (
    <PanelFrame title="社員別" header={<div className="kanalytics__right"><span className="kanalytics__borrow">持出</span>/<span className="kanalytics__return">返却</span></div>}>
      {rows.length === 0 ? <p className="kanalytics__empty">データがありません。</p> : (
        <ul className={listClass(mode, 'rank')}>
          {rows.map((row, index) => (
            <li key={row.employeeId}>
              <span className="kanalytics__no">{index + 1}</span>
              <div className="kanalytics__body">
                <span className="kanalytics__t1" title={row.displayName}>{row.displayName}</span>
                <div className="kanalytics__track" aria-hidden="true">
                  <i className="kanalytics__bar-borrow" style={{ width: `${row.periodBorrowCount / maxActivity * 100}%` }} />
                  <i className="kanalytics__bar-return" style={{ width: `${row.periodReturnCount / maxActivity * 100}%` }} />
                </div>
              </div>
              <span className="kanalytics__num"><span className="kanalytics__borrow">{row.periodBorrowCount}</span><em>/</em><span className="kanalytics__return">{row.periodReturnCount}</span></span>
            </li>
          ))}
          {mode === 'all' && <MoreRow total={totalCount} shown={rows.length} />}
        </ul>
      )}
    </PanelFrame>
  );
}

export function AssetBorrowFrequencyPanel({ rows, title, mode, totalCount }: { rows: AssetRow[]; title: string; mode: AnalyticsListMode; totalCount: number }) {
  const maxValue = Math.max(1, ...rows.map((row) => row.periodBorrowCount));
  return (
    <PanelFrame title={title} header={<div className="kanalytics__right">持出回数</div>}>
      {rows.length === 0 ? <p className="kanalytics__empty">データがありません。</p> : (
        <ul className={listClass(mode, 'rank')}>
          {rows.map((row, index) => (
            <li key={row.id}>
              <span className="kanalytics__no">{index + 1}</span>
              <div className="kanalytics__body">
                <AssetLabel row={row} />
                <div className="kanalytics__track" aria-hidden="true"><i className="kanalytics__bar-borrow" style={{ width: `${row.periodBorrowCount / maxValue * 100}%` }} /></div>
              </div>
              <span className="kanalytics__num kanalytics__borrow">{row.periodBorrowCount}</span>
            </li>
          ))}
          {mode === 'all' && <MoreRow total={totalCount} shown={rows.length} />}
        </ul>
      )}
    </PanelFrame>
  );
}

export function TodayEventsPane({ rows, mode, borrowCount, returnCount, totalCount }: {
  totalCount: number;
  rows: TodayEventDisplayRow[];
  mode: AnalyticsListMode;
  borrowCount: number;
  returnCount: number;
}) {
  return (
    <PanelFrame title="今日" header={<>
      <span className="kanalytics__chip kanalytics__chip--borrow">持出 {borrowCount}</span>
      <span className="kanalytics__chip kanalytics__chip--return">返却 {returnCount}</span>
    </>}>
      {rows.length === 0 ? <p className="kanalytics__empty">今日はまだありません</p> : (
        <ul className={listClass(mode, 'today')}>
          {rows.map((row) => (
            <li key={`${row.kind}-${row.assetId}-${row.eventAt}`}>
              <time className="kanalytics__time" dateTime={row.eventAt}>{row.timeLabel}</time>
              <span className={`kanalytics__kind kanalytics__kind--${row.kind === 'BORROW' ? 'borrow' : 'return'}`}>{row.kind === 'BORROW' ? '持出' : '返却'}</span>
              <span className="kanalytics__t1 kanalytics__name" title={row.assetLabel}>{row.assetLabel}</span>
              <span className="kanalytics__who" title={row.actorDisplayName ?? '—'}>{row.actorDisplayName ?? '—'}</span>
            </li>
          ))}
          {mode === 'all' && <MoreRow total={totalCount} shown={rows.length} />}
        </ul>
      )}
    </PanelFrame>
  );
}
