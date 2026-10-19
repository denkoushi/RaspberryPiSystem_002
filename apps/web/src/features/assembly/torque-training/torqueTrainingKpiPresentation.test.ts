import { describe, expect, it } from 'vitest';

import {
  formatSignedTrainingPercent,
  formatTrainingPercent,
  formatTrainingRate,
  summarizeTrainingSessionAttempts,
  trainingErrorDelta,
  trainingRateDelta,
  trainingTendency
} from './torqueTrainingKpiPresentation';

describe('torqueTrainingKpiPresentation', () => {
  it('formats missing values as a dash', () => {
    expect(formatTrainingRate(null)).toBe('—');
    expect(formatTrainingPercent(undefined)).toBe('—');
    expect(trainingTendency(null)).toEqual({ label: '—', tone: 'none', signedLabel: '—' });
    expect(trainingRateDelta(0.8, null)).toBeNull();
  });

  it('formats rates and percentages', () => {
    expect(formatTrainingRate(0.836)).toBe('84');
    expect(formatTrainingPercent(5.23)).toBe('5.2');
    expect(formatSignedTrainingPercent(-1.64)).toBe('−1.6%');
    expect(formatSignedTrainingPercent(2.6)).toBe('+2.6%');
    expect(formatSignedTrainingPercent(0.01)).toBe('±0.0%');
  });

  it('names the tightening direction with 1% and 3% boundaries', () => {
    expect(trainingTendency(0.9).label).toBe('ほぼ中央');
    expect(trainingTendency(-1)).toMatchObject({ label: 'やや弱め', tone: 'weak' });
    expect(trainingTendency(2.9)).toMatchObject({ label: 'やや強め', tone: 'strong' });
    expect(trainingTendency(-3)).toMatchObject({ label: '弱め', tone: 'weak' });
    expect(trainingTendency(5.7)).toMatchObject({ label: '強め', tone: 'strong', signedLabel: '+5.7%' });
  });

  it('marks a higher pass rate and a lower error as improvements', () => {
    expect(trainingRateDelta(0.84, 0.78)).toEqual({ label: '▲ 6pt', improved: true });
    expect(trainingRateDelta(0.7, 0.78)).toEqual({ label: '▼ 8pt', improved: false });
    expect(trainingErrorDelta(5.2, 6.4)).toEqual({ label: '▼ 1.2pt', improved: true });
    expect(trainingErrorDelta(6.4, 6.4)).toEqual({ label: '± 0.0pt', improved: null });
  });

  it('summarizes one session with the same accepted-attempt rule as the server', () => {
    expect(summarizeTrainingSessionAttempts([
      { accepted: true, judgement: 'OK', deviationPercent: '-2', absoluteDeviationPercent: '2' },
      { accepted: true, judgement: 'OVER', deviationPercent: '17', absoluteDeviationPercent: '17' },
      { accepted: false, judgement: 'IGNORED', deviationPercent: '40', absoluteDeviationPercent: '40' }
    ])).toEqual({ okCount: 1, meanAbsoluteErrorPercent: 9.5, meanDeviationPercent: 7.5 });
    expect(summarizeTrainingSessionAttempts([])).toEqual({ okCount: 0, meanAbsoluteErrorPercent: null, meanDeviationPercent: null });
  });
});
