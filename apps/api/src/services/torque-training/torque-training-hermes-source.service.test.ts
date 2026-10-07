import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.hoisted(() => vi.fn());
const queryRaw = vi.hoisted(() => vi.fn());
vi.mock('../../lib/prisma.js', () => ({ prisma: { torqueTrainingSession: { findMany }, $queryRaw: queryRaw } }));

import {
  createTorqueTrainingSourceReaders, torqueTrainingOperatorRows, torqueTrainingSessionRows,
  torqueTrainingTeamRow, type TrainingSearchSession
} from './torque-training-hermes-source.service.js';
import { summarizeTrainingAttempts } from './torque-training.policy.js';
import { TEAM_RECENT_SESSION_LIMIT, TorqueTrainingTeamSummaryService } from './torque-training-team-summary.service.js';

function attempt(attemptNo: number, deviation: number, judgement: 'OK' | 'UNDER' | 'OVER' | 'IGNORED' = 'OK') {
  return {
    attemptNo, accepted: true, judgement, deviationPercent: new Prisma.Decimal(deviation),
    absoluteDeviationPercent: new Prisma.Decimal(Math.abs(deviation)),
    valueNm: new Prisma.Decimal(10 + deviation / 10), nominalTorqueSnapshot: new Prisma.Decimal(10),
    lowerLimitSnapshot: new Prisma.Decimal(9.5), upperLimitSnapshot: new Prisma.Decimal(10.5),
    serialNumberSnapshot: 'SYNTH-001', manufacturerSnapshot: '合成メーカー', modelNumberSnapshot: 'SYNTH-WRENCH'
  };
}
function session(id: string, overrides: Partial<TrainingSearchSession> = {}): TrainingSearchSession {
  return {
    id, employeeId: 'operator-a', employeeNameSnapshot: '合成作業者A', employeeCodeSnapshot: 'SYNTH-A',
    clientDeviceNameSnapshot: '合成端末', conditionFingerprint: 'condition-a', status: 'COMPLETED',
    excludedAt: null, completedAt: new Date('2026-10-03T15:00:00Z'),
    programVersion: { displayName: '合成締付訓練', nominalDiameter: 'M10', material: '合成鋼', nominalTorque: new Prisma.Decimal(10), unit: 'N·m', boltLengthMm: new Prisma.Decimal(30), strengthClass: '8.8', lowerLimit: new Prisma.Decimal(9.5), upperLimit: new Prisma.Decimal(10.5), jigConditionCode: 'SYNTH-JIG' },
    attempts: [attempt(1, 2), attempt(2, 6, 'OVER'), attempt(3, -7, 'UNDER')],
    ...overrides
  };
}

beforeEach(() => {
  findMany.mockReset();
  queryRaw.mockReset();
});

describe('torque training Hermes session rows', () => {
  it('excludes unfinished and excluded sessions, unaccepted/ignored/null-deviation attempts', () => {
    const valid = session('valid', { attempts: [attempt(1, 2), { ...attempt(2, 99), accepted: false }, attempt(3, 50, 'IGNORED'), { ...attempt(4, 0), deviationPercent: null }] });
    const rows = torqueTrainingSessionRows([
      valid, session('excluded', { excludedAt: new Date() }), session('cancelled', { status: 'CANCELLED' }),
      session('running', { status: 'IN_PROGRESS' })
    ]);
    expect(rows.map(row => row.id)).toEqual(['valid']);
    expect(rows[0]).toMatchObject({ attemptCount: '1', passRate: '100.0', overallJudgement: '全回合格' });
    expect(rows[0]!.attemptsText).not.toMatch(/2回目|3回目|4回目/);
    const operators = torqueTrainingOperatorRows([valid, session('excluded', { excludedAt: new Date() }), session('cancelled', { status: 'CANCELLED' })]);
    expect(operators).toHaveLength(1);
    expect(operators[0]).toMatchObject({ sessionCount: '1', attemptCount: '1' });
  });

  it('uses snapshots, JST completion day, policy metrics, signed maximum and Japanese failure words', () => {
    const source = session('s1');
    const expected = summarizeTrainingAttempts(source.attempts);
    const row = torqueTrainingSessionRows([source])[0]!;
    expect(row).toMatchObject({
      kind: 'torque_training_session', sessionId: 's1', employeeName: '合成作業者A', employeeCode: 'SYNTH-A',
      trainingName: '合成締付訓練', targetBolt: 'M10', material: '合成鋼', targetTorque: '10 N·m',
      terminalName: '合成端末', completedOn: '2026-10-04', wrench: '合成メーカー SYNTH-WRENCH SYNTH-001', overallJudgement: '不合格あり',
      attemptCount: String(expected.attemptCount), passRate: (expected.passRate * 100).toFixed(1),
      meanAbsoluteErrorPercent: expected.meanAbsoluteErrorPercent.toFixed(1), meanDeviationPercent: expected.meanDeviationPercent.toFixed(1)
    });
    expect(row.summaryText).toContain('3回中1回合格');
    expect(row.summaryText).toContain('最大偏差 -7.0%');
    expect(row.summaryText).toContain('2回目が上限超え');
    expect(row.summaryText).toContain('3回目が下限未満');
    expect(row.attemptsText).toContain('2回目: 10.6 N·m、目標 10 N·m、下限 9.5 N·m、上限 10.5 N·m、上限超え');
    expect(torqueTrainingSessionRows([session('positive', { attempts: [attempt(1, 6, 'OVER')] })])[0]!.summaryText).toContain('最大偏差 +6.0%');
  });

  it('does not call an empty completed session all-pass', () => {
    const row = torqueTrainingSessionRows([session('empty', { attempts: [], completedAt: null })])[0]!;
    expect(row).toMatchObject({ attemptCount: '0', passRate: '', completedOn: '', overallJudgement: '実績なし' });
    expect(row.summaryText).not.toContain('全回合格');
  });
});

describe('torque training Hermes operator rows', () => {
  it('ranks only operators with attempts, keeps ties, and uses identity rather than names', () => {
    const rows = torqueTrainingOperatorRows([
      session('a', { attempts: [attempt(1, 2)] }),
      session('b', { employeeId: 'b', employeeCodeSnapshot: 'SYNTH-B', attempts: [attempt(1, -2)] }),
      session('c', { employeeId: 'c', employeeNameSnapshot: '合成作業者C', attempts: [attempt(1, 2), attempt(2, 8, 'OVER')] }),
      session('d', { employeeId: 'd', attempts: [] })
    ]);
    expect(rows.map(row => [row.id, row.passRateRank, row.rankingPopulation])).toEqual([
      ['d', '', '3'], ['c', '3', '3'], ['b', '1', '3'], ['operator-a', '1', '3']
    ]);
    expect(rows.find(row => row.id === 'operator-a')!.summaryText).toContain('強めに締める傾向');
    expect(rows.find(row => row.id === 'b')!.summaryText).toContain('弱めに締める傾向');
    expect(rows.find(row => row.id === 'd')!.summaryText).toContain('順位なし');
  });

  it('handles a single operator, all-zero population, and zero signed bias', () => {
    expect(torqueTrainingOperatorRows([session('one', { attempts: [attempt(1, 0)] })])[0]).toMatchObject({ passRateRank: '1', rankingPopulation: '1' });
    expect(torqueTrainingOperatorRows([session('one', { attempts: [attempt(1, 0)] })])[0]!.summaryText).toContain('偏りなし');
    expect(torqueTrainingOperatorRows([session('zero', { attempts: [] })])[0]).toMatchObject({ passRateRank: '', rankingPopulation: '0', passRate: '' });
    expect(torqueTrainingOperatorRows([session('zero', { attempts: [] })])[0]!.comparisonText).toContain('比較に必要な締付実績なし');
    expect(torqueTrainingOperatorRows([])).toEqual([]);
  });

  it('limits recent metrics to ten sessions, compares improvement, and separates condition fingerprints', () => {
    const sessions = Array.from({ length: 12 }, (_, index) => session(`s${index}`, {
      completedAt: new Date(Date.UTC(2026, 8, index + 1)),
      conditionFingerprint: index < 2 ? 'condition-old' : 'condition-new',
      employeeNameSnapshot: index === 11 ? '合成作業者A改名' : '合成作業者A',
      attempts: [attempt(1, index < 2 ? 8 : 1, index < 2 ? 'OVER' : 'OK')]
    }));
    const row = torqueTrainingOperatorRows(sessions)[0]!;
    const expected = summarizeTrainingAttempts(sessions.flatMap(s => s.attempts));
    const expectedRecent = summarizeTrainingAttempts(sessions.slice(2).flatMap(s => s.attempts));
    expect(row).toMatchObject({
      sessionCount: '12', attemptCount: String(expected.attemptCount), passRate: (expected.passRate * 100).toFixed(1),
      meanAbsoluteErrorPercent: expected.meanAbsoluteErrorPercent.toFixed(1), meanDeviationPercent: expected.meanDeviationPercent.toFixed(1),
      recentSessionCount: String(TEAM_RECENT_SESSION_LIMIT), recentAttemptCount: String(expectedRecent.attemptCount),
      recentPassRate: (expectedRecent.passRate * 100).toFixed(1), recentMeanAbsoluteErrorPercent: expectedRecent.meanAbsoluteErrorPercent.toFixed(1),
      recentMeanDeviationPercent: expectedRecent.meanDeviationPercent.toFixed(1), employeeName: '合成作業者A改名', lastTrainingOn: '2026-09-12'
    });
    expect(row.comparisonText).toContain('上達傾向');
    expect(row.conditionsText).toContain('治具SYNTH-JIG: 全期間2セッション');
    expect(row.conditionsText).toContain('治具SYNTH-JIG: 全期間10セッション');
    expect(row.conditionsText).toContain('長さ30 mm');
    expect(row.conditionsText).not.toContain('condition-old');
    const worsening = sessions.map((s, index) => ({ ...s, attempts: [attempt(1, index < 2 ? 1 : -8, index < 2 ? 'OK' : 'UNDER')] }));
    expect(torqueTrainingOperatorRows(worsening)[0]!.comparisonText).toContain('改善は見られません');
  });
});

describe('torque training Hermes database readers and team row', () => {
  it('shares a filtered Prisma read in one refresh and refreshes it on the next factory call', async () => {
    findMany.mockResolvedValue([session('s1')]);
    const readers = createTorqueTrainingSourceReaders();
    await readers.torque_training_session();
    await readers.torque_training_operator();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'COMPLETED', excludedAt: null }, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }]
    }));
    await createTorqueTrainingSourceReaders().torque_training_session();
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('matches the existing team summary service recent and all-time values without loading all sessions', async () => {
    findMany.mockResolvedValue([session('recent')]);
    queryRaw.mockResolvedValue([{ sessionCount: 12, operatorCount: 3, attemptCount: 60, okCount: 50, meanAbsoluteErrorPercent: 3.25, meanDeviationPercent: -1.75 }]);
    const summary = await new TorqueTrainingTeamSummaryService().summary();
    const [row] = await createTorqueTrainingSourceReaders().torque_training_team();
    expect(row).toEqual(torqueTrainingTeamRow(summary));
    expect(row).toMatchObject({ sessionCount: '12', operatorCount: '3', attemptCount: '60', passRate: (summary.allTime.passRate! * 100).toFixed(1), meanAbsoluteErrorPercent: (3.25).toFixed(1), meanDeviationPercent: (-1.75).toFixed(1), recentAttemptCount: '3' });
    expect(row!.summaryText).toContain('全期間');
    expect(row!.recentText).toContain('直近1セッション');
    expect(findMany.mock.calls.every(([args]) => args.take === TEAM_RECENT_SESSION_LIMIT)).toBe(true);
    const sql = queryRaw.mock.calls[0]![0] as Prisma.Sql;
    expect(sql.strings.join('')).toContain('s."excludedAt" IS NULL');
    expect(sql.strings.join('')).toContain('s."status" = \'COMPLETED\'');
  });

  it('preserves no-data semantics for an empty team', async () => {
    findMany.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);
    const [row] = await createTorqueTrainingSourceReaders().torque_training_team();
    expect(row).toMatchObject({ id: 'team', sessionCount: '0', attemptCount: '0', passRate: '', recentPassRate: '' });
    expect(row!.summaryText).toContain('締付実績なし');
  });
});
