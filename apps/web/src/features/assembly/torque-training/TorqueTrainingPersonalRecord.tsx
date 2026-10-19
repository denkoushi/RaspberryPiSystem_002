import {
  formatTrainingPercent,
  formatTrainingRate,
  passedTrainingAttempts,
  trainingTendency
} from './torqueTrainingKpiPresentation';
import { TENDENCY_TEXT_CLASS } from './TorqueTrainingTeamKpiBand';

import type { TorqueTrainingMetricApi, TorqueTrainingTeamSummaryApi } from '../../../api/client';

export type TorqueTrainingPersonalRecordProps = {
  metrics: TorqueTrainingMetricApi[];
  /** 選択中または実施中のメニューの条件。先頭に大きく出す。 */
  focusFingerprint: string | null;
  /** 完了直後のセッション。最新の棒を「今回」と呼ぶために使う。 */
  completedSessionId: string | null;
  team: Partial<TorqueTrainingTeamSummaryApi> | null | undefined;
};

function menuLabel(metric: TorqueTrainingMetricApi): string {
  return metric.material ? `${metric.targetBolt} ${metric.material}` : metric.trainingName;
}

function PassedBars({ counts, maxCount, latestLabel }: { counts: number[]; maxCount: number; latestLabel: string }) {
  const width = 540;
  const height = 190;
  const left = 28;
  const bottom = 28;
  const top = 18;
  const slot = (width - left) / 10;
  const barWidth = slot * 0.62;
  const y = (count: number) => top + (1 - count / maxCount) * (height - top - bottom);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`合格本数の推移 ${counts.join('、')}`}>
      {[0, maxCount].map((tick) => (
        <g key={tick}>
          <line x1={left} x2={width} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'} />
          <text x={left - 8} y={y(tick) + 5} fill="#64748b" fontSize={13} textAnchor="end">{tick}</text>
        </g>
      ))}
      {counts.map((count, index) => {
        const latest = index === counts.length - 1;
        const cx = left + slot * index + slot / 2;
        return (
          <g key={index}>
            <rect x={cx - barWidth / 2} y={y(count)} width={barWidth} height={Math.max(y(0) - y(count), 0)} rx={3} fill={latest ? '#67e8f9' : 'rgba(110,231,183,0.55)'} />
            <text x={cx} y={y(count) - 6} fill={latest ? '#67e8f9' : '#94a3b8'} fontSize={15} fontWeight={700} textAnchor="middle">{count}</text>
            {latest ? <text x={cx} y={height - 6} fill="#67e8f9" fontSize={14} fontWeight={700} textAnchor="middle">{latestLabel}</text> : null}
          </g>
        );
      })}
      {counts.length > 1 ? <text x={left + slot / 2} y={height - 6} fill="#64748b" fontSize={13} textAnchor="middle">古</text> : null}
    </svg>
  );
}

/**
 * タグの本人の成績。「前回→今回」と直近10回の合格本数を中心に見せ、
 * 数値は上段の全体KPIと同じ3指標で比べられるようにする。
 */
export function TorqueTrainingPersonalRecord({ metrics, focusFingerprint, completedSessionId, team }: TorqueTrainingPersonalRecordProps) {
  const focus = metrics.find((metric) => metric.conditionFingerprint === focusFingerprint)
    ?? (focusFingerprint ? null : metrics[0] ?? null);
  const others = metrics.filter((metric) => metric !== focus);

  return (
    <section className="flex min-h-0 flex-col gap-5" aria-label="自分の成績">
      {focus ? <FocusCard metric={focus} completedSessionId={completedSessionId} team={team} /> : (
        <div className="grid gap-1">
          <h2 className="text-xl font-bold">自分の成績</h2>
          <p className="text-base text-white/60">{metrics.length ? 'このメニューは初めてです' : 'まだ記録がありません'}</p>
        </div>
      )}
      {others.length > 0 ? (
        <div>
          <h3 className="mb-1 text-base font-bold text-white/60">ほかのメニュー</h3>
          <ul className="border-t border-white/10">
            {others.map((metric) => {
              const latest = metric.sessions[0];
              return (
                <li key={metric.conditionFingerprint} className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-3 border-b border-white/10 py-2 text-base" title={metric.trainingName}>
                  <span className="truncate">{menuLabel(metric)}</span>
                  <span className="text-sm text-white/60">
                    {latest ? `前回 ${passedTrainingAttempts(latest.attemptCount, latest.passRate)}/${latest.attemptCount}` : ''}
                  </span>
                  <span className="text-right font-bold tabular-nums">{formatTrainingRate(metric.passRate)}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function FocusCard({ metric, completedSessionId, team }: {
  metric: TorqueTrainingMetricApi;
  completedSessionId: string | null;
  team: Partial<TorqueTrainingTeamSummaryApi> | null | undefined;
}) {
  const [latest, previous] = metric.sessions;
  const latestIsCurrent = Boolean(completedSessionId && latest?.sessionId === completedSessionId);
  const passed = (session: TorqueTrainingMetricApi['sessions'][number]) => passedTrainingAttempts(session.attemptCount, session.passRate);
  const oldestFirst = [...metric.sessions].reverse();
  const counts = oldestFirst.map(passed);
  const maxCount = Math.max(5, ...oldestFirst.map((session) => session.attemptCount));
  const best = counts.length ? Math.max(...counts) : null;
  const tendency = trainingTendency(metric.meanDeviationPercent);

  return (
    <article className="grid gap-4" data-testid="torque-training-growth-card" title={metric.trainingName}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">自分の成績</h2>
        <p className="text-base text-white/60">{menuLabel(metric)} · 直近{metric.sessions.length}回</p>
      </div>

      {latest ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-800/80 px-4 py-3">
          {latestIsCurrent ? (
            <>
              {previous ? (
                <>
                  <span className="text-sm text-white/60">前回</span>
                  <span className="text-3xl font-black tabular-nums">{passed(previous)}/{previous.attemptCount}</span>
                  <span className="text-2xl text-slate-500" aria-hidden="true">→</span>
                </>
              ) : null}
              <span className="text-sm text-white/60">今回</span>
              <span className="text-3xl font-black tabular-nums text-cyan-300">{passed(latest)}/{latest.attemptCount}</span>
              {previous ? <ChangeText change={passed(latest) - passed(previous)} /> : <span className="ml-auto text-base text-white/60">初回</span>}
            </>
          ) : (
            <>
              <span className="text-sm text-white/60">前回</span>
              <span className="text-3xl font-black tabular-nums">{passed(latest)}/{latest.attemptCount}</span>
              <span className="ml-auto text-sm text-white/60">ベスト</span>
              <span className="text-3xl font-black tabular-nums">{best}/{maxCount}</span>
            </>
          )}
        </div>
      ) : null}

      <div>
        <h3 className="text-base font-bold text-white/60">合格本数（{maxCount}本中）</h3>
        <PassedBars counts={counts} maxCount={maxCount} latestLabel={latestIsCurrent ? '今回' : '前回'} />
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <div className="rounded bg-slate-800/80 px-3 py-2">
          <dt className="text-sm text-white/60">合格率</dt>
          <dd className="text-2xl font-black tabular-nums">{formatTrainingRate(metric.passRate)}%</dd>
          <dd className="text-xs text-white/50">全体 {formatTrainingRate(team?.passRate)}%</dd>
        </div>
        <div className="rounded bg-slate-800/80 px-3 py-2">
          <dt className="text-sm text-white/60">平均ずれ</dt>
          <dd className="text-2xl font-black tabular-nums">{formatTrainingPercent(metric.meanAbsoluteErrorPercent)}%</dd>
          <dd className="text-xs text-white/50">全体 {formatTrainingPercent(team?.meanAbsoluteErrorPercent)}%</dd>
        </div>
        <div className="rounded bg-slate-800/80 px-3 py-2">
          <dt className="text-sm text-white/60">強弱の傾向</dt>
          <dd className={`truncate text-xl font-black leading-8 ${TENDENCY_TEXT_CLASS[tendency.tone]}`}>{tendency.label}</dd>
          <dd className="text-xs text-white/50">{tendency.signedLabel}</dd>
        </div>
      </dl>
    </article>
  );
}

function ChangeText({ change }: { change: number }) {
  if (change === 0) return <span className="ml-auto text-lg font-bold text-white/60">前回と同じ</span>;
  return (
    <span className={`ml-auto text-xl font-bold ${change > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
      {change > 0 ? '▲' : '▼'} {Math.abs(change)}本
    </span>
  );
}
