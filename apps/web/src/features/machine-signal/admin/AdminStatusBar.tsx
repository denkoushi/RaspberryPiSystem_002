import { describeGmailSchedule } from '../machineSignalAdminModel';

import type { MachineSignalAdminOverview } from '../../../api/client';

const shortDate = (dateKey: string) => `${Number(dateKey.slice(5, 7))}/${dateKey.slice(8, 10)}`;

/** 上段。最新の日報、Gmail の自動取り込み、取り込み済みの日、取り込みの操作。 */
export function AdminStatusBar({
  overview,
  gmailPending,
  onRunGmail,
  onOpenImport
}: {
  overview: MachineSignalAdminOverview | undefined;
  gmailPending: boolean;
  onRunGmail: () => void;
  onOpenImport: () => void;
}) {
  const gmail = describeGmailSchedule(overview?.gmailSchedule?.schedule ?? null, new Date());
  const gmailOff = overview?.gmailSchedule.enabled === false;
  const coverage = overview?.coverage ?? [];

  return (
    <header className="top">
      <div className="title">
        <h1>設備稼働</h1>
        <span>センサー・判定・取り込み</span>
      </div>
      <div className="stat">
        <small>最新の日報</small>
        <b className="num">
          {overview?.latestReportDate ? shortDate(overview.latestReportDate) : '–'}
          {overview?.latestReportDate ? <i>{overview.latestReportCount}台</i> : null}
        </b>
      </div>
      <div className="stat">
        <small>GMAIL 自動取り込み</small>
        <b className={gmailOff ? 'off' : undefined}>
          {gmailOff ? '停止中' : gmail.label}
          {!gmailOff && gmail.next ? <i>次は {gmail.next}</i> : null}
        </b>
      </div>
      <div className="stat cover">
        <small>取り込み済みの日（直近{coverage.length || 60}日）</small>
        <div className="cells" role="img" aria-label={`直近${coverage.length}日のうち ${coverage.filter((day) => day.count > 0).length}日を取り込み済み`}>
          {coverage.map((day) => (
            <i key={day.date} className={day.count > 0 ? 'on' : undefined} title={`${shortDate(day.date)} ${day.count}件`} />
          ))}
        </div>
        <div className="ends">
          <span>{coverage[0] ? shortDate(coverage[0].date) : ''}</span>
          <span>{coverage.length > 0 ? shortDate(coverage[coverage.length - 1].date) : ''}</span>
        </div>
      </div>
      <div className="acts">
        <button className="btn" type="button" onClick={onRunGmail} disabled={gmailPending}>
          {gmailPending ? '確認中…' : 'Gmailを今すぐ確認'}
        </button>
        <button className="btn pri" type="button" onClick={onOpenImport}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
          </svg>
          過去分を取り込む
        </button>
      </div>
    </header>
  );
}
