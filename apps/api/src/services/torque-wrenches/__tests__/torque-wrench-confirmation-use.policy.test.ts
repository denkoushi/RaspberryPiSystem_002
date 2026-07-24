import { describe, expect, it } from 'vitest';

import {
  TorqueWrenchConfirmationUsePolicy,
  type TorqueWrenchConfirmationEvidence,
  type TorqueWrenchConfirmationExpectation,
  type TorqueWrenchLeaseEvidence
} from '../torque-wrench-confirmation-use.policy.js';

const policy = new TorqueWrenchConfirmationUsePolicy();
const now = new Date('2026-07-23T08:00:30.000Z');

function confirmation(
  overrides: Partial<TorqueWrenchConfirmationEvidence> = {}
): TorqueWrenchConfirmationEvidence {
  return {
    id: 'confirmation-a',
    sessionId: 'work-a',
    torqueWrenchProfileId: 'wrench-a',
    settingHistoryId: 'setting-a',
    conditionFingerprint: 'condition-a',
    clientDeviceId: 'assembly-01',
    confirmedAt: new Date('2026-07-23T08:00:20.000Z'),
    ...overrides
  };
}

function expected(
  overrides: Partial<TorqueWrenchConfirmationExpectation> = {}
): TorqueWrenchConfirmationExpectation {
  return {
    sessionId: 'work-b',
    clientDeviceId: 'assembly-01',
    torqueWrenchProfileId: 'wrench-a',
    settingHistoryId: 'setting-a',
    conditionFingerprint: 'condition-a',
    ...overrides
  };
}

function lease(overrides: Partial<TorqueWrenchLeaseEvidence> = {}): TorqueWrenchLeaseEvidence {
  return {
    leaseId: 'lease-a',
    generation: 12,
    adoptedConfirmationId: 'confirmation-a',
    ownerClientDeviceId: 'assembly-01',
    ownerSessionId: 'work-a',
    acquiredAt: new Date('2026-07-23T08:00:00.000Z'),
    expiresAt: new Date('2026-07-23T08:00:40.000Z'),
    releasedAt: null,
    ...overrides
  };
}

describe('TorqueWrenchConfirmationUsePolicy', () => {
  it('reuses an adopted confirmation for another work ID and lot on the same terminal', () => {
    expect(policy.evaluateAdoptedReuse(confirmation(), lease(), expected())).toEqual({
      allowed: true,
      mode: 'adopted_reuse'
    });
  });

  it('does not make work ID, operator, or elapsed time part of adopted validity', () => {
    const muchLater = new Date('2027-01-23T08:00:00.000Z');
    expect(policy.evaluateLeaseAdoption({
      confirmation: confirmation({ sessionId: 'old-lot-work' }),
      lease: lease({ expiresAt: new Date('2026-07-23T08:00:01.000Z'), releasedAt: new Date('2026-07-23T08:00:02.000Z') }),
      expected: expected({ sessionId: 'new-lot-work' }),
      now: muchLater
    })).toEqual({ allowed: true, mode: 'adopted_reuse' });
  });

  it('rejects an adopted confirmation on a terminal that is not the retained owner', () => {
    expect(policy.evaluateAdoptedReuse(
      confirmation({ clientDeviceId: 'stonebase' }),
      lease(),
      expected({ clientDeviceId: 'stonebase' })
    )).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
  });

  it.each([
    ['settingHistoryId', 'setting-b'],
    ['conditionFingerprint', 'condition-b']
  ] as const)('invalidates a confirmation when %s changes', (field, value) => {
    expect(policy.evaluateAdoptedReuse(
      confirmation(),
      lease(),
      expected({ [field]: value })
    )).toEqual({ allowed: false, reason: 'CONFIRMATION_STALE' });
  });

  it('requires a destination confirmation newer than the active foreign ownership epoch', () => {
    const foreignLease = lease({
      adoptedConfirmationId: 'confirmation-stone',
      ownerClientDeviceId: 'stonebase',
      ownerSessionId: 'stone-work',
      acquiredAt: new Date('2026-07-23T08:00:10.000Z')
    });
    expect(policy.evaluateLeaseAdoption({
      confirmation: confirmation({ confirmedAt: new Date('2026-07-23T08:00:09.000Z'), sessionId: 'work-b' }),
      lease: foreignLease,
      expected: expected(),
      now
    })).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
    expect(policy.evaluateLeaseAdoption({
      confirmation: confirmation({ confirmedAt: new Date('2026-07-23T08:00:11.000Z'), sessionId: 'work-b' }),
      lease: foreignLease,
      expected: expected(),
      now
    })).toEqual({ allowed: true, mode: 'current_session' });
  });

  it('requires a destination confirmation made after a foreign release', () => {
    const released = lease({
      adoptedConfirmationId: 'confirmation-stone',
      ownerClientDeviceId: 'stonebase',
      ownerSessionId: 'stone-work',
      releasedAt: new Date('2026-07-23T08:00:25.000Z')
    });
    expect(policy.evaluateLeaseAdoption({
      confirmation: confirmation({ confirmedAt: new Date('2026-07-23T08:00:24.000Z'), sessionId: 'work-b' }),
      lease: released,
      expected: expected(),
      now
    })).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
    expect(policy.evaluateLeaseAdoption({
      confirmation: confirmation({ confirmedAt: new Date('2026-07-23T08:00:26.000Z'), sessionId: 'work-b' }),
      lease: released,
      expected: expected(),
      now
    })).toEqual({ allowed: true, mode: 'current_session' });
  });

  it('accepts cross-session agent input only when the lease adopted that confirmation', () => {
    expect(policy.evaluateAgentLease({
      lease: lease({ ownerSessionId: 'work-b' }),
      leaseEnforced: false,
      leaseId: 'lease-a',
      generation: 12,
      confirmationId: 'confirmation-a',
      clientDeviceId: 'assembly-01',
      sessionId: 'work-b'
    })).toEqual({ allowed: true, mode: 'lease' });
    expect(policy.evaluateAgentLease({
      lease: lease({ ownerSessionId: 'work-b' }),
      leaseEnforced: false,
      leaseId: 'lease-a',
      generation: 12,
      confirmationId: 'confirmation-old',
      clientDeviceId: 'assembly-01',
      sessionId: 'work-b'
    })).toEqual({ allowed: false, reason: 'CONFIRMATION_REQUIRED' });
  });

  it('preserves the tokenless fallback only while enforcement is off', () => {
    expect(policy.evaluateAgentLease({
      lease: null,
      leaseEnforced: false,
      confirmationId: 'confirmation-a',
      clientDeviceId: 'assembly-01',
      sessionId: 'work-a'
    })).toEqual({ allowed: true, mode: 'legacy' });
    expect(policy.evaluateAgentLease({
      lease: null,
      leaseEnforced: true,
      confirmationId: 'confirmation-a',
      clientDeviceId: 'assembly-01',
      sessionId: 'work-a'
    })).toEqual({ allowed: false, reason: 'CONNECTION_LEASE_REQUIRED' });
  });

  it('fences a previous generation and rejects owner or target-session mismatch', () => {
    expect(policy.evaluateAgentLease({
      lease: lease(),
      leaseEnforced: true,
      leaseId: 'lease-a',
      generation: 11,
      confirmationId: 'confirmation-a',
      clientDeviceId: 'assembly-01',
      sessionId: 'work-a'
    })).toEqual({ allowed: false, reason: 'CONNECTION_LEASE_FENCED' });
    expect(policy.evaluateAgentLease({
      lease: lease(),
      leaseEnforced: true,
      leaseId: 'lease-a',
      generation: 12,
      confirmationId: 'confirmation-a',
      clientDeviceId: 'stonebase',
      sessionId: 'work-a'
    })).toEqual({ allowed: false, reason: 'CONNECTION_LEASE_OWNER_MISMATCH' });
    expect(policy.evaluateAgentLease({
      lease: lease(),
      leaseEnforced: true,
      leaseId: 'lease-a',
      generation: 12,
      confirmationId: 'confirmation-a',
      clientDeviceId: 'assembly-01',
      sessionId: 'work-b'
    })).toEqual({ allowed: false, reason: 'CONNECTION_LEASE_SESSION_MISMATCH' });
  });
});
