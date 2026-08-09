import { describe, expect, it } from 'vitest';

import {
  decideTrainingAttempt,
  summarizeTrainingAttempts,
  trainingConditionFingerprint
} from './torque-training.policy.js';

const condition = {
  nominalDiameter: 'M6',
  boltLengthMm: 20,
  material: 'SUS',
  strengthClass: '8.8',
  capabilityGroupId: 'group-1',
  lowerLimit: 8,
  nominalTorque: 10,
  upperLimit: 12,
  unit: 'N-m',
  jigConditionCode: 'JIG-A'
};

describe('torque training policy', () => {
  it('keeps the normalized unit in the immutable condition fingerprint', () => {
    expect(trainingConditionFingerprint(condition)).toBe(trainingConditionFingerprint({ ...condition, unit: ' n-m ' }));
    expect(trainingConditionFingerprint(condition)).not.toBe(trainingConditionFingerprint({ ...condition, unit: 'kgf-cm' }));
  });

  it('judges the inclusive limits and aggregates population variation', () => {
    expect(decideTrainingAttempt(8, 'N-m', condition).judgement).toBe('OK');
    expect(decideTrainingAttempt(7.9, 'N-m', condition).judgement).toBe('UNDER');
    expect(decideTrainingAttempt(12.1, 'N-m', condition).judgement).toBe('OVER');
    expect(summarizeTrainingAttempts([
      { accepted: true, judgement: 'OK', deviationPercent: 0, absoluteDeviationPercent: 0 },
      { accepted: true, judgement: 'UNDER', deviationPercent: -10, absoluteDeviationPercent: 10 },
      { accepted: true, judgement: 'OVER', deviationPercent: 10, absoluteDeviationPercent: 10 }
    ])).toMatchObject({ attemptCount: 3, passRate: 1 / 3, meanAbsoluteErrorPercent: 20 / 3, variationPercent: expect.closeTo(Math.sqrt(200 / 3), 8) });
  });
});
