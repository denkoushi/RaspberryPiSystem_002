import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  TorqueWrenchConfirmationUsePolicy,
  type TorqueWrenchConfirmationEvidence,
  type TorqueWrenchConfirmationExpectation,
  type TorqueWrenchLeaseEvidence
} from '../torque-wrench-confirmation-use.policy.js';
import {
  isTorqueWrenchConfirmationFreshForAcquire
} from '../torque-wrench-confirmation-freshness.policy.js';
import {
  normalizeTorqueWrenchSettingVerificationMode
} from '../torque-wrench-setting-mode.policy.js';
import {
  torqueWrenchSettingEvidenceSnapshot
} from '../torque-wrench-setting-evidence.policy.js';
import {
  TorqueWrenchEligibilityPolicy,
  type TorqueCondition,
  type TorqueWrenchCandidate
} from '../torque-wrench-eligibility.policy.js';

const eligibilityPolicy = new TorqueWrenchEligibilityPolicy();
const confirmationPolicy = new TorqueWrenchConfirmationUsePolicy();
const eligibilityNow = new Date('2026-08-27T12:00:00.000+09:00');
const confirmationNow = new Date('2026-08-27T03:00:30.000Z');

const condition: TorqueCondition = {
  templateBoltId: 'bolt-optional-1',
  nominalDiameter: 'M10',
  boltLengthMm: '35',
  material: 'SCM435',
  strengthClass: '10.9',
  capabilityGroupId: 'group-optional-1',
  lowerLimit: '28',
  nominalTorque: '30',
  upperLimit: '32',
  unit: 'N·m'
};

const matchingSetting: NonNullable<TorqueWrenchCandidate['setting']> = {
  id: 'setting-optional-1',
  lowerLimitNm: '28',
  nominalTorqueNm: '30',
  upperLimitNm: '32'
};

const candidate: TorqueWrenchCandidate = {
  profileId: 'profile-optional-1',
  modelId: 'model-optional-1',
  status: 'AVAILABLE',
  calibrationExpiryDate: new Date('2026-08-28T00:00:00.000+09:00'),
  modelTorqueMinNm: '10',
  modelTorqueMaxNm: '50',
  capabilityGroupId: 'group-optional-1',
  capabilityGroupIsActive: true,
  capabilityGroupNominalDiameter: 'M10',
  capabilityGroupBoltLengthMm: '35',
  capabilityGroupMaterial: 'SCM435',
  capabilityGroupStrengthClass: '10.9',
  capabilityModelIds: ['model-optional-1'],
  setting: matchingSetting
};

function boltOnlyCandidate(
  overrides: Partial<TorqueWrenchCandidate> = {}
): TorqueWrenchCandidate {
  return {
    ...candidate,
    settingVerificationMode: 'BOLT_CONDITION_ONLY',
    setting: null,
    ...overrides
  };
}

function confirmation(
  overrides: Partial<TorqueWrenchConfirmationEvidence> = {}
): TorqueWrenchConfirmationEvidence {
  return {
    id: 'confirmation-optional-a',
    sessionId: 'session-optional-a',
    torqueWrenchProfileId: 'profile-optional-1',
    settingHistoryId: 'setting-optional-1',
    settingVerificationMode: 'BOLT_CONDITION_ONLY',
    conditionFingerprint: 'condition-optional-a',
    clientDeviceId: 'client-optional-a',
    confirmedAt: new Date('2026-08-27T02:59:20.000Z'),
    ...overrides
  };
}

function expected(
  overrides: Partial<TorqueWrenchConfirmationExpectation> = {}
): TorqueWrenchConfirmationExpectation {
  return {
    sessionId: 'session-optional-a',
    clientDeviceId: 'client-optional-a',
    torqueWrenchProfileId: 'profile-optional-1',
    settingHistoryId: 'setting-optional-1',
    settingVerificationMode: 'BOLT_CONDITION_ONLY',
    conditionFingerprint: 'condition-optional-a',
    ...overrides
  };
}

function lease(
  overrides: Partial<TorqueWrenchLeaseEvidence> = {}
): TorqueWrenchLeaseEvidence {
  return {
    leaseId: 'lease-optional-a',
    generation: 4,
    adoptedConfirmationId: null,
    ownerKind: 'ASSEMBLY',
    ownerClientDeviceId: 'client-optional-a',
    ownerSessionId: 'session-optional-a',
    acquiredAt: new Date('2026-08-27T02:59:00.000Z'),
    expiresAt: new Date('2026-08-27T03:01:00.000Z'),
    releasedAt: null,
    ...overrides
  };
}

describe('torque-wrench optional setting eligibility', () => {
  it.each([null, undefined])('normalizes %s mode to REGISTERED_SETTING', (mode) => {
    expect(normalizeTorqueWrenchSettingVerificationMode(mode)).toBe('REGISTERED_SETTING');
  });

  it.each([
    ['missing', null],
    ['matching', matchingSetting],
    ['mismatching', { ...matchingSetting, nominalTorqueNm: '31' }]
  ] as const)('keeps the registered-setting behavior for %s setting history', (label, setting) => {
    const result = eligibilityPolicy.evaluate(
      condition,
      { ...candidate, settingVerificationMode: null, setting },
      eligibilityNow
    );

    expect(result).toEqual(
      label === 'missing'
        ? { eligible: false, reason: 'SETTING_HISTORY_MISSING' }
        : label === 'mismatching'
          ? { eligible: false, reason: 'SETTING_MISMATCH' }
          : { eligible: true, conditionFingerprint: expect.any(String) }
    );
  });

  it.each([
    ['missing', null],
    ['matching', matchingSetting],
    ['mismatching', { ...matchingSetting, nominalTorqueNm: '31' }]
  ] as const)('ignores registered setting history in BOLT_CONDITION_ONLY mode for %s', (_label, setting) => {
    expect(eligibilityPolicy.evaluate(
      condition,
      boltOnlyCandidate({ setting }),
      eligibilityNow
    )).toEqual({ eligible: true, conditionFingerprint: expect.any(String) });
  });

  it.each([
    [{ modelTorqueMaxNm: '31' }, 'MODEL_RANGE_NOT_COVERED'],
    [{ calibrationExpiryDate: null }, 'CALIBRATION_MISSING'],
    [{ calibrationExpiryDate: new Date('2026-08-26T00:00:00.000+09:00') }, 'CALIBRATION_EXPIRED'],
    [{ status: 'MAINTENANCE' }, 'INSTRUMENT_STATUS_NOT_ELIGIBLE'],
    [{ capabilityGroupId: 'different-group' }, 'WRONG_CAPABILITY_GROUP'],
    [{ capabilityGroupIsActive: false }, 'WRONG_CAPABILITY_GROUP'],
    [{ capabilityGroupNominalDiameter: 'M12' }, 'WRONG_CAPABILITY_GROUP']
  ] as const)('retains %s safety rejection in BOLT_CONDITION_ONLY mode', (overrides, reason) => {
    expect(eligibilityPolicy.evaluate(
      condition,
      boltOnlyCandidate(overrides),
      eligibilityNow
    )).toEqual({ eligible: false, reason });
  });
});

describe('torque-wrench setting evidence snapshots', () => {
  const existingHistory = {
    lowerLimit: new Prisma.Decimal('28'),
    nominalTorque: new Prisma.Decimal('30'),
    upperLimit: new Prisma.Decimal('32'),
    unit: 'N·m'
  };

  it('leaves all setting snapshots null in BOLT_CONDITION_ONLY mode even with existing history', () => {
    expect(torqueWrenchSettingEvidenceSnapshot(
      'BOLT_CONDITION_ONLY',
      existingHistory
    )).toEqual({
      lowerLimit: null,
      nominalTorque: null,
      upperLimit: null,
      unit: null
    });
  });

  it('preserves existing history values in REGISTERED_SETTING mode', () => {
    expect(torqueWrenchSettingEvidenceSnapshot(
      'REGISTERED_SETTING',
      existingHistory
    )).toEqual(existingHistory);
  });
});

describe('torque-wrench optional setting confirmation use', () => {
  it.each([
    ['REGISTERED_SETTING', 'BOLT_CONDITION_ONLY'],
    ['BOLT_CONDITION_ONLY', 'REGISTERED_SETTING']
  ] as const)('invalidates a confirmation when its mode changes from %s to %s', (confirmationMode, expectedMode) => {
    expect(confirmationPolicy.evaluateCurrentSession(
      confirmation({ settingVerificationMode: confirmationMode }),
      expected({ settingVerificationMode: expectedMode })
    )).toEqual({ allowed: false, reason: 'CONFIRMATION_STALE' });
  });

  it('ignores a setting-history ID change only for BOLT_CONDITION_ONLY', () => {
    expect(confirmationPolicy.evaluateCurrentSession(
      confirmation({ settingHistoryId: 'old-setting' }),
      expected({ settingHistoryId: 'new-setting' })
    )).toEqual({ allowed: true, mode: 'current_session' });

    expect(confirmationPolicy.evaluateCurrentSession(
      confirmation({ settingVerificationMode: 'REGISTERED_SETTING', settingHistoryId: 'old-setting' }),
      expected({ settingVerificationMode: 'REGISTERED_SETTING', settingHistoryId: 'new-setting' })
    )).toEqual({ allowed: false, reason: 'CONFIRMATION_STALE' });
  });

  it('requires an explicit generation 0 and null adopted confirmation when no lease exists', () => {
    expect(isTorqueWrenchConfirmationFreshForAcquire(
      confirmation({ observedLeaseGeneration: 0, observedAdoptedConfirmationId: null }),
      null,
      confirmationNow
    )).toBe(true);
    expect(isTorqueWrenchConfirmationFreshForAcquire(
      confirmation(),
      null,
      confirmationNow
    )).toBe(false);
  });

  it('accepts a pending BOLT confirmation with the current lease snapshot', () => {
    expect(confirmationPolicy.evaluateLeaseAdoption({
      confirmation: confirmation({ observedLeaseGeneration: 4, observedAdoptedConfirmationId: null }),
      lease: lease(),
      expected: expected(),
      now: confirmationNow
    })).toEqual({ allowed: true, mode: 'current_session' });
  });

  it.each([
    { observedLeaseGeneration: 3, observedAdoptedConfirmationId: null },
    { observedLeaseGeneration: 4, observedAdoptedConfirmationId: 'different-confirmation' }
  ] as const)('rejects a BOLT confirmation when the current lease snapshot differs: %o', (snapshot) => {
    expect(confirmationPolicy.evaluateLeaseAdoption({
      confirmation: confirmation(snapshot),
      lease: lease(),
      expected: expected(),
      now: confirmationNow
    })).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
  });

  it('allows an already-adopted confirmation only for the same active owner, client, and session', () => {
    const adopted = confirmation({
      // The confirmation was captured before the current lease adopted its
      // own row, so its snapshot belongs to the previous lease epoch.
      sessionId: 'session-optional-a',
      observedLeaseGeneration: 3,
      observedAdoptedConfirmationId: 'previous-confirmation'
    });
    const activeLease = lease({ generation: 4, adoptedConfirmationId: adopted.id });

    expect(confirmationPolicy.evaluateLeaseAdoption({
      confirmation: adopted,
      lease: activeLease,
      expected: expected(),
      now: confirmationNow
    })).toEqual({ allowed: true, mode: 'adopted_reuse' });

    for (const mismatch of [
      { clientDeviceId: 'different-client' },
      { sessionId: 'different-session' },
      { ownerKind: 'TRAINING' as const }
    ]) {
      expect(confirmationPolicy.evaluateLeaseAdoption({
        confirmation: adopted,
        lease: activeLease,
        expected: expected(mismatch),
        now: confirmationNow
      })).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
    }
  });

  it.each([
    { releasedAt: new Date('2026-08-27T03:00:20.000Z') },
    { expiresAt: new Date('2026-08-27T03:00:20.000Z'), releasedAt: null },
    { ownerClientDeviceId: 'different-client' },
    { ownerSessionId: 'different-session' }
  ] as const)('rejects an adopted confirmation after lease end, expiry, or ownership change: %o', (overrides) => {
    const activeConfirmation = confirmation({
      observedLeaseGeneration: 4,
      observedAdoptedConfirmationId: 'confirmation-optional-a'
    });
    expect(confirmationPolicy.evaluateLeaseAdoption({
      confirmation: activeConfirmation,
      lease: lease({ adoptedConfirmationId: activeConfirmation.id, ...overrides }),
      expected: expected(),
      now: new Date('2026-08-27T03:00:30.000Z')
    })).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
  });

  it.each([
    { releasedAt: new Date('2026-08-27T03:00:20.000Z') },
    { expiresAt: new Date('2026-08-27T03:00:20.000Z'), releasedAt: null }
  ] as const)('rejects a non-adopted confirmation created before lease %s boundary', (overrides) => {
    expect(confirmationPolicy.evaluateLeaseAdoption({
      confirmation: confirmation({
        observedLeaseGeneration: 4,
        observedAdoptedConfirmationId: null,
        confirmedAt: new Date('2026-08-27T03:00:10.000Z')
      }),
      lease: lease(overrides),
      expected: expected(),
      now: new Date('2026-08-27T03:00:30.000Z')
    })).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
  });

  it('rejects an old A confirmation after an A to B to A lease handoff', () => {
    const confirmationFromA = confirmation({
      sessionId: 'session-optional-a',
      observedLeaseGeneration: 0,
      observedAdoptedConfirmationId: null,
      confirmedAt: new Date('2026-08-27T02:58:00.000Z')
    });
    const leaseAfterBReturnedToA = lease({
      generation: 6,
      adoptedConfirmationId: 'confirmation-from-b',
      ownerClientDeviceId: 'client-optional-a',
      ownerSessionId: 'session-optional-a'
    });

    expect(confirmationPolicy.evaluateLeaseAdoption({
      confirmation: confirmationFromA,
      lease: leaseAfterBReturnedToA,
      expected: expected(),
      now: confirmationNow
    })).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
  });

  it('preserves registered-setting snapshotless first use and post-end same-condition reuse', () => {
    const firstRegistered = confirmation({
      sessionId: 'registered-session-a',
      settingVerificationMode: undefined,
      observedLeaseGeneration: undefined,
      observedAdoptedConfirmationId: undefined
    });
    expect(confirmationPolicy.evaluateLeaseAdoption({
      confirmation: firstRegistered,
      lease: null,
      expected: expected({
        sessionId: 'registered-session-a',
        settingVerificationMode: undefined
      }),
      now: confirmationNow
    })).toEqual({ allowed: true, mode: 'current_session' });

    const endedRegistered = confirmation({
      id: 'registered-confirmation-a',
      sessionId: 'registered-session-a',
      settingVerificationMode: undefined,
      observedLeaseGeneration: undefined,
      observedAdoptedConfirmationId: undefined
    });
    expect(confirmationPolicy.evaluateLeaseAdoption({
      confirmation: endedRegistered,
      lease: lease({
        adoptedConfirmationId: endedRegistered.id,
        ownerSessionId: 'registered-session-a',
        expiresAt: new Date('2026-08-27T02:59:00.000Z'),
        releasedAt: new Date('2026-08-27T02:59:01.000Z')
      }),
      expected: expected({
        sessionId: 'registered-session-b',
        settingVerificationMode: undefined
      }),
      now: confirmationNow
    })).toEqual({ allowed: true, mode: 'adopted_reuse' });
  });
});
