import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { summarizeTrainingAttempts } from './torque-training.policy.js';
import {
  TEAM_RECENT_SESSION_LIMIT,
  TorqueTrainingTeamSummaryService,
  type TorqueTrainingTeamSummary
} from './torque-training-team-summary.service.js';

const sessionSelect = Prisma.validator<Prisma.TorqueTrainingSessionSelect>()({
  id: true, employeeId: true, employeeCodeSnapshot: true, employeeNameSnapshot: true,
  clientDeviceNameSnapshot: true, conditionFingerprint: true, status: true, excludedAt: true, completedAt: true,
  programVersion: { select: {
    displayName: true, nominalDiameter: true, boltLengthMm: true, material: true, strengthClass: true,
    nominalTorque: true, lowerLimit: true, upperLimit: true, unit: true, jigConditionCode: true
  } },
  attempts: {
    orderBy: [{ attemptNo: 'asc' }, { recordedAt: 'asc' }],
    select: {
      attemptNo: true, accepted: true, judgement: true, valueNm: true,
      nominalTorqueSnapshot: true, lowerLimitSnapshot: true, upperLimitSnapshot: true,
      deviationPercent: true, absoluteDeviationPercent: true,
      serialNumberSnapshot: true, manufacturerSnapshot: true, modelNumberSnapshot: true
    }
  }
});

export type TrainingSearchSession = Prisma.TorqueTrainingSessionGetPayload<{ select: typeof sessionSelect }>;
type SearchRow = Record<string, string>;
export type TorqueTrainingSourceId = 'torque_training_session' | 'torque_training_operator' | 'torque_training_team';

type Metrics = ReturnType<typeof summarizeTrainingAttempts>;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
});
function completedOn(date: Date | null): string {
  if (!date) return '';
  const parts = dateFormatter.formatToParts(date);
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function searchableSessions(sessions: TrainingSearchSession[]): TrainingSearchSession[] {
  return sessions.filter(session => session.status === 'COMPLETED' && session.excludedAt === null)
    .sort((a, b) => (b.completedAt?.getTime() ?? -Infinity) - (a.completedAt?.getTime() ?? -Infinity)
      || b.id.localeCompare(a.id));
}
function countedAttempts(sessions: TrainingSearchSession[]) {
  return sessions.flatMap(session => session.attempts)
    .filter(attempt => attempt.accepted && attempt.judgement !== 'IGNORED' && attempt.deviationPercent !== null);
}
function metrics(sessions: TrainingSearchSession[]): Metrics {
  return summarizeTrainingAttempts(countedAttempts(sessions));
}
// One decimal everywhere, so a metadata value never disagrees with the sentence beside it.
const percent = (value: number) => value.toFixed(1);
function metricFields(metric: Metrics | TorqueTrainingTeamSummary): SearchRow {
  const hasAttempts = metric.attemptCount > 0;
  return {
    attemptCount: String(metric.attemptCount),
    passRate: hasAttempts && metric.passRate !== null ? percent(metric.passRate * 100) : '',
    meanAbsoluteErrorPercent: hasAttempts ? percent(metric.meanAbsoluteErrorPercent!) : '',
    meanDeviationPercent: hasAttempts ? percent(metric.meanDeviationPercent!) : ''
  };
}
function metricText(metric: Metrics | TorqueTrainingTeamSummary): string {
  if (!metric.attemptCount) return '締付0回。集計対象の締付実績なし。';
  return `締付${metric.attemptCount}回。合格率 ${percent(metric.passRate! * 100)}%。平均絶対誤差 ${percent(metric.meanAbsoluteErrorPercent!)}%。平均偏差 ${percent(metric.meanDeviationPercent!)}%。`;
}
function tendency(metric: Metrics): string {
  if (!metric.attemptCount) return '強め・弱めの傾向は判定できません。';
  return metric.meanDeviationPercent > 0 ? '強めに締める傾向。'
    : metric.meanDeviationPercent < 0 ? '弱めに締める傾向。' : '平均偏差はゼロ。強め・弱めの偏りなし。';
}
function comparison(recent: Metrics, allTime: Metrics): string {
  if (!recent.attemptCount || !allTime.attemptCount) return '上達の比較に必要な締付実績なし。';
  const pass = recent.passRate - allTime.passRate;
  const error = recent.meanAbsoluteErrorPercent - allTime.meanAbsoluteErrorPercent;
  const conclusion = pass >= 0 && error <= 0 && (pass > 0 || error < 0) ? '上達傾向。'
    : pass <= 0 && error >= 0 && (pass < 0 || error > 0) ? '合格率・誤差の改善は見られません。'
      : pass === 0 && error === 0 ? '全期間と同じ成績。' : '合格率と誤差の変化が異なるため上達は一概に判定できません。';
  return `全期間との比較: 合格率は${pass > 0 ? '上昇' : pass < 0 ? '低下' : '同じ'}、平均絶対誤差は${error < 0 ? '減少' : error > 0 ? '増加' : '同じ'}。${conclusion}`;
}
function conditionText(session: TrainingSearchSession): string {
  const program = session.programVersion;
  return `${program.displayName} / ${program.nominalDiameter} / 長さ${program.boltLengthMm} mm / ${program.material} / 強度${program.strengthClass} / 目標${program.nominalTorque} ${program.unit} / 下限${program.lowerLimit}・上限${program.upperLimit} ${program.unit} / 治具${program.jigConditionCode}`;
}

export function torqueTrainingSessionRows(sessions: TrainingSearchSession[]): SearchRow[] {
  return searchableSessions(sessions).map(session => {
    const attempts = countedAttempts([session]);
    const metric = metrics([session]);
    const okCount = attempts.filter(attempt => attempt.judgement === 'OK').length;
    const maxDeviation = attempts.reduce<number | null>((max, attempt) => {
      const value = Number(attempt.deviationPercent);
      return max === null || Math.abs(value) > Math.abs(max) ? value : max;
    }, null);
    const judgementText = (judgement: string) => judgement === 'OK' ? '合格' : judgement === 'OVER' ? '上限超え' : '下限未満';
    const failures = attempts.filter(attempt => attempt.judgement !== 'OK')
      .map(attempt => `${attempt.attemptNo ?? '?'}回目が${judgementText(attempt.judgement)}。`).join('');
    const overallJudgement = !attempts.length ? '実績なし' : okCount === attempts.length ? '全回合格' : '不合格あり';
    return {
      kind: 'torque_training_session', id: session.id, sessionId: session.id,
      employeeName: session.employeeNameSnapshot, employeeCode: session.employeeCodeSnapshot,
      trainingName: session.programVersion.displayName, targetBolt: session.programVersion.nominalDiameter,
      material: session.programVersion.material, targetTorque: `${session.programVersion.nominalTorque} ${session.programVersion.unit}`,
      wrench: [...new Set(attempts.map(attempt => [attempt.manufacturerSnapshot, attempt.modelNumberSnapshot, attempt.serialNumberSnapshot].filter(Boolean).join(' ')))].filter(Boolean).join('、'),
      terminalName: session.clientDeviceNameSnapshot, completedOn: completedOn(session.completedAt), overallJudgement,
      ...metricFields(metric),
      summaryText: `${attempts.length}回中${okCount}回合格。${overallJudgement}。${metricText(metric)}${maxDeviation === null ? '' : `最大偏差 ${maxDeviation >= 0 ? '+' : ''}${maxDeviation.toFixed(1)}%。`}${failures}`,
      attemptsText: attempts.map(attempt => `${attempt.attemptNo ?? '?'}回目: ${attempt.valueNm ?? '未記録'} N·m、目標 ${attempt.nominalTorqueSnapshot ?? '未記録'} N·m、下限 ${attempt.lowerLimitSnapshot ?? '未記録'} N·m、上限 ${attempt.upperLimitSnapshot ?? '未記録'} N·m、${judgementText(attempt.judgement)}。`).join('\n')
    };
  });
}

export function torqueTrainingOperatorRows(sessions: TrainingSearchSession[]): SearchRow[] {
  const grouped = new Map<string, TrainingSearchSession[]>();
  for (const session of searchableSessions(sessions)) {
    const rows = grouped.get(session.employeeId) ?? [];
    rows.push(session);
    grouped.set(session.employeeId, rows);
  }
  const operators = [...grouped.entries()].map(([id, rows]) => ({ id, rows, allTime: metrics(rows) }));
  const ranked = operators.filter(operator => operator.allTime.attemptCount > 0);
  return operators.map(({ id, rows, allTime }) => {
    const latest = rows[0]!;
    const recentSessions = rows.slice(0, TEAM_RECENT_SESSION_LIMIT);
    const recent = metrics(recentSessions);
    // Competition ranking: tied pass rates share a rank; zero-attempt operators have no rank.
    const rank = allTime.attemptCount ? 1 + ranked.filter(operator => operator.allTime.passRate > allTime.passRate).length : null;
    const conditions = new Map<string, TrainingSearchSession[]>();
    for (const session of rows) {
      const group = conditions.get(session.conditionFingerprint) ?? [];
      group.push(session);
      conditions.set(session.conditionFingerprint, group);
    }
    return {
      kind: 'torque_training_operator', id, employeeName: latest.employeeNameSnapshot, employeeCode: latest.employeeCodeSnapshot,
      sessionCount: String(rows.length), ...metricFields(allTime),
      recentSessionCount: String(recentSessions.length), recentAttemptCount: String(recent.attemptCount),
      recentPassRate: recent.attemptCount ? percent(recent.passRate * 100) : '',
      recentMeanAbsoluteErrorPercent: recent.attemptCount ? percent(recent.meanAbsoluteErrorPercent) : '',
      recentMeanDeviationPercent: recent.attemptCount ? percent(recent.meanDeviationPercent) : '',
      lastTrainingOn: completedOn(latest.completedAt), passRateRank: rank === null ? '' : String(rank), rankingPopulation: String(ranked.length),
      summaryText: `全期間: 訓練${rows.length}セッション。${metricText(allTime)}${tendency(allTime)}${rank === null ? '締付実績なしのため順位なし。' : `合格率順位 ${rank}位 / 締付実績のある従業員${ranked.length}人中（同率は同順位）。`}`,
      comparisonText: `直近${recentSessions.length}セッション（最大${TEAM_RECENT_SESSION_LIMIT}）: ${metricText(recent)}${tendency(recent)}${comparison(recent, allTime)}`,
      conditionsText: [...conditions.values()].map(group => {
        const conditionRecent = group.slice(0, TEAM_RECENT_SESSION_LIMIT);
        return `${conditionText(group[0]!)}: 全期間${group.length}セッション。${metricText(metrics(group))}直近${conditionRecent.length}セッション: ${metricText(metrics(conditionRecent))}`;
      }).join('\n')
    };
  });
}

export function torqueTrainingTeamRow(summary: { recent: TorqueTrainingTeamSummary; allTime: TorqueTrainingTeamSummary }): SearchRow {
  return {
    kind: 'torque_training_team', id: 'team', teamName: '訓練チーム全体',
    sessionCount: String(summary.allTime.sessionCount), operatorCount: String(summary.allTime.operatorCount), ...metricFields(summary.allTime),
    recentSessionCount: String(summary.recent.sessionCount), recentOperatorCount: String(summary.recent.operatorCount),
    recentAttemptCount: String(summary.recent.attemptCount), recentPassRate: metricFields(summary.recent).passRate!,
    recentMeanAbsoluteErrorPercent: metricFields(summary.recent).meanAbsoluteErrorPercent!,
    recentMeanDeviationPercent: metricFields(summary.recent).meanDeviationPercent!,
    summaryText: `チーム全体の全期間: 訓練${summary.allTime.sessionCount}セッション、従業員${summary.allTime.operatorCount}人。${metricText(summary.allTime)}`,
    recentText: `チーム全体の直近${summary.recent.sessionCount}セッション（最大${TEAM_RECENT_SESSION_LIMIT}）: 従業員${summary.recent.operatorCount}人。${metricText(summary.recent)}`
  };
}

// One refresh shares the same session read across the session and operator sources.
// The team-only source uses the existing bounded/SQL aggregation service directly.
export function createTorqueTrainingSourceReaders() {
  let sessions: Promise<TrainingSearchSession[]> | undefined;
  const loadSessions = () => sessions ??= prisma.torqueTrainingSession.findMany({
    where: { status: 'COMPLETED', excludedAt: null },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }], select: sessionSelect
  });
  return {
    torque_training_session: async () => torqueTrainingSessionRows(await loadSessions()),
    torque_training_operator: async () => torqueTrainingOperatorRows(await loadSessions()),
    torque_training_team: async () => [torqueTrainingTeamRow(await new TorqueTrainingTeamSummaryService().summary())]
  };
}
