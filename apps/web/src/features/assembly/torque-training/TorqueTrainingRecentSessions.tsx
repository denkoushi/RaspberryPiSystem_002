import { TorqueTrainingJudgementDots, TorqueTrainingJudgementLegend } from './TorqueTrainingJudgementDots';

import type { TorqueTrainingTeamRecentSessionApi } from '../../../api/client';

function formatCompletedAt(completedAt: string | null, now: Date): string {
  if (!completedAt) return '—';
  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) return '—';
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

export type TorqueTrainingRecentSessionsProps = {
  sessions: TorqueTrainingTeamRecentSessionApi[] | null | undefined;
  now?: Date;
};

/** タグ前の右ペイン。全員分の直近10回を、名前と5本の結果で並べる。 */
export function TorqueTrainingRecentSessions({ sessions, now = new Date() }: TorqueTrainingRecentSessionsProps) {
  const rows = sessions ?? [];
  return (
    <section className="flex min-h-0 flex-col gap-2" aria-label="直近10回の訓練" data-testid="torque-training-recent-sessions">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">直近10回の訓練</h2>
        <TorqueTrainingJudgementLegend />
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-base text-white/60">まだ記録がありません</p>
      ) : (
        <ul className="min-h-0 overflow-auto">
          {rows.map((session) => (
            <li
              key={session.sessionId}
              className="grid grid-cols-[3.5rem_minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 py-2.5 text-base"
              title={session.trainingName}
            >
              <span className="text-sm text-white/60 tabular-nums">{formatCompletedAt(session.completedAt, now)}</span>
              <span className="truncate font-bold">{session.employeeName}</span>
              <span className="truncate">{session.targetBolt} {session.material}</span>
              <TorqueTrainingJudgementDots judgements={session.judgements} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
