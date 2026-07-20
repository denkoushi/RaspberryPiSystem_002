import { describe, expect, it } from 'vitest';
import {
  TorqueWrenchEligibilityPolicy,
  torqueConditionFingerprint,
  type TorqueCondition,
  type TorqueWrenchCandidate
} from '../torque-wrench-eligibility.policy.js';

const condition: TorqueCondition = {
  templateBoltId: 'bolt-1',
  nominalDiameter: 'M10',
  boltLengthMm: '35',
  material: 'SCM435',
  strengthClass: '10.9',
  capabilityGroupId: 'group-1',
  lowerLimit: '28',
  nominalTorque: '30',
  upperLimit: '32',
  unit: 'N·m'
};

const candidate: TorqueWrenchCandidate = {
  profileId: 'profile-1',
  modelId: 'model-1',
  status: 'AVAILABLE',
  calibrationExpiryDate: new Date('2026-07-17T00:00:00+09:00'),
  modelTorqueMinNm: '10',
  modelTorqueMaxNm: '50',
  capabilityGroupId: 'group-1',
  capabilityGroupIsActive: true,
  capabilityGroupNominalDiameter: 'M10',
  capabilityGroupBoltLengthMm: '35',
  capabilityGroupMaterial: 'SCM435',
  capabilityGroupStrengthClass: '10.9',
  capabilityModelIds: ['model-1'],
  setting: { id: 'setting-1', lowerLimitNm: '28', nominalTorqueNm: '30', upperLimitNm: '32' }
};

describe('TorqueWrenchEligibilityPolicy', () => {
  const policy = new TorqueWrenchEligibilityPolicy();

  it('accepts a matching model, current setting and calibration valid on the Tokyo date', () => {
    expect(policy.evaluate(condition, candidate, new Date('2026-07-17T23:59:00+09:00'))).toMatchObject({ eligible: true });
  });

  it('expires on the next Tokyo calendar day', () => {
    expect(policy.evaluate(condition, candidate, new Date('2026-07-18T00:00:00+09:00'))).toEqual({
      eligible: false,
      reason: 'CALIBRATION_EXPIRED'
    });
  });

  it('reuses a confirmation across different markers when every tightening condition is identical', () => {
    expect(torqueConditionFingerprint({ ...condition, templateBoltId: 'bolt-2' })).toBe(
      torqueConditionFingerprint(condition)
    );
  });

  it.each([
    [{ ...candidate, status: 'MAINTENANCE' }, 'INSTRUMENT_STATUS_NOT_ELIGIBLE'],
    [{ ...candidate, calibrationExpiryDate: null }, 'CALIBRATION_MISSING'],
    [{ ...candidate, setting: null }, 'SETTING_HISTORY_MISSING'],
    [{ ...candidate, modelTorqueMaxNm: '31' }, 'MODEL_RANGE_NOT_COVERED'],
    [{ ...candidate, setting: { ...candidate.setting!, nominalTorqueNm: '31' } }, 'SETTING_MISMATCH'],
    [{ ...candidate, capabilityGroupId: 'other' }, 'WRONG_CAPABILITY_GROUP'],
    [{ ...candidate, capabilityGroupNominalDiameter: 'M12' }, 'WRONG_CAPABILITY_GROUP'],
    [{ ...candidate, capabilityGroupIsActive: false }, 'WRONG_CAPABILITY_GROUP']
  ] as const)('rejects each independent safety failure', (input, reason) => {
    expect(policy.evaluate(condition, input, new Date('2026-07-17T12:00:00+09:00'))).toEqual({ eligible: false, reason });
  });
});
