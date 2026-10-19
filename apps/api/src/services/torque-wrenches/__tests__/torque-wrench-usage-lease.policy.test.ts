import { describe, expect, it } from 'vitest';

import {
  nextUsageLeaseConnectAfter,
  serializeUsageLeaseStatus
} from '../torque-wrench-usage-lease.policy.js';

const now = new Date('2026-08-18T00:00:00.000Z');

function trainingRow(overrides: Partial<{
  leaseId: string;
  generation: number;
  expiresAt: Date;
  connectAfter: Date;
  releasedAt: Date | null;
}> = {}) {
  return {
    ownerKind: 'TRAINING' as const,
    ownerClientDeviceId: 'kiosk-1',
    ownerAssemblySessionId: null,
    ownerTrainingSessionId: 'training-1',
    generation: 4,
    leaseId: 'lease-4',
    expiresAt: new Date('2026-08-18T00:00:08.000Z'),
    connectAfter: now,
    releasedAt: null,
    ownerClientDevice: { name: 'Training Kiosk', location: 'Line A' },
    ...overrides
  };
}

describe('torque wrench usage lease policy', () => {
  it('preserves a future connectAfter on same-owner reacquire', () => {
    const handoff = new Date('2026-08-18T00:00:05.000Z');

    expect(nextUsageLeaseConnectAfter(
      trainingRow({ connectAfter: handoff }),
      now,
      { sameOwner: true, takeover: false }
    )).toBe(handoff);
  });

  it('sets takeover connectAfter after the previous active lease expires', () => {
    const expiresAt = new Date('2026-08-18T00:00:08.000Z');

    expect(nextUsageLeaseConnectAfter(
      trainingRow({ expiresAt }),
      now,
      { sameOwner: false, takeover: true, previousExpiresAt: expiresAt }
    )).toEqual(new Date('2026-08-18T00:00:09.000Z'));
  });

  it('does not carry a waiting deadline into a same-owner takeover', () => {
    const expiresAt = new Date('2026-08-18T00:00:08.000Z');
    const waiting = new Date('2026-08-18T00:00:05.000Z');

    expect(nextUsageLeaseConnectAfter(
      trainingRow({ expiresAt, connectAfter: waiting }),
      now,
      { sameOwner: true, takeover: true, previousExpiresAt: expiresAt }
    )).toEqual(new Date('2026-08-18T00:00:09.000Z'));
  });

  it('redacts tokens and private identity across owner kinds', () => {
    const status = serializeUsageLeaseStatus(
      'profile-1',
      trainingRow(),
      { ownerKind: 'ASSEMBLY', clientDeviceId: 'kiosk-1' },
      now
    );

    expect(status).toMatchObject({
      state: 'owned_by_other',
      owner: {
        ownerKind: 'TRAINING',
        clientDeviceName: 'Training Kiosk',
        clientDeviceLocation: 'Line A'
      }
    });
    expect(status).not.toHaveProperty('leaseId');
    expect(status).not.toHaveProperty('generation');
    expect(status.owner).not.toHaveProperty('clientDeviceId');
    expect(status.owner).not.toHaveProperty('sessionId');
  });

  it('returns tokens only to the exact owner view', () => {
    const status = serializeUsageLeaseStatus(
      'profile-1',
      trainingRow({ connectAfter: new Date('2026-08-18T00:00:01.000Z') }),
      { ownerKind: 'TRAINING', clientDeviceId: 'kiosk-1', sessionId: 'training-1' },
      now
    );

    expect(status).toMatchObject({
      state: 'handoff_wait',
      leaseId: 'lease-4',
      generation: 4,
      owner: {
        clientDeviceId: 'kiosk-1',
        sessionId: 'training-1'
      }
    });
  });

  it('redacts tokens for another session on the same client', () => {
    const status = serializeUsageLeaseStatus(
      'profile-1',
      trainingRow(),
      { ownerKind: 'TRAINING', clientDeviceId: 'kiosk-1', sessionId: 'training-2' },
      now
    );

    expect(status.state).toBe('owned_by_other');
    expect(status).not.toHaveProperty('leaseId');
    expect(status).not.toHaveProperty('generation');
    expect(status.owner).not.toHaveProperty('clientDeviceId');
    expect(status.owner).not.toHaveProperty('sessionId');
  });
});
