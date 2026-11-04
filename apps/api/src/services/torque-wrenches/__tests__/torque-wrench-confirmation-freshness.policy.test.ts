import { describe, expect, it } from 'vitest';

import {
  isTorqueWrenchConfirmationActiveOwnerRetry,
  isTorqueWrenchConfirmationFreshForAcquire,
  type TorqueWrenchConfirmationFreshnessEvidence,
  type TorqueWrenchConfirmationFreshnessLeaseOwner,
} from '../torque-wrench-confirmation-freshness.policy.js';

const now = new Date('2026-11-03T12:00:00.000Z');
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

function confirmation(
  overrides: Partial<TorqueWrenchConfirmationFreshnessEvidence> = {}
): TorqueWrenchConfirmationFreshnessEvidence {
  return {
    id: 'conf-1',
    confirmedAt: at(-1_000),
    observedLeaseGeneration: 3,
    observedAdoptedConfirmationId: 'conf-0',
    ...overrides,
  };
}

function lease(overrides: Partial<TorqueWrenchConfirmationFreshnessLeaseOwner> = {}): TorqueWrenchConfirmationFreshnessLeaseOwner {
  return {
    generation: 3,
    adoptedConfirmationId: 'conf-0',
    expiresAt: at(5_000),
    releasedAt: null,
    ownerClientDeviceId: 'kiosk-a',
    ownerSessionId: 'session-a',
    ownerKind: 'ASSEMBLY',
    ...overrides,
  };
}

describe('isTorqueWrenchConfirmationFreshForAcquire', () => {
  describe('リース未作成', () => {
    it('世代0・採用確認null を観測した確認だけが有効', () => {
      expect(isTorqueWrenchConfirmationFreshForAcquire(
        confirmation({ observedLeaseGeneration: 0, observedAdoptedConfirmationId: null }), null, now
      )).toBe(true);
    });

    it('観測値が未記録(undefined/null)のレガシー確認は無効', () => {
      expect(isTorqueWrenchConfirmationFreshForAcquire(
        confirmation({ observedLeaseGeneration: undefined, observedAdoptedConfirmationId: undefined }), null, now
      )).toBe(false);
      expect(isTorqueWrenchConfirmationFreshForAcquire(
        confirmation({ observedLeaseGeneration: null, observedAdoptedConfirmationId: null }), null, now
      )).toBe(false);
    });

    it('世代0でも採用確認IDを観測していれば無効', () => {
      expect(isTorqueWrenchConfirmationFreshForAcquire(
        confirmation({ observedLeaseGeneration: 0, observedAdoptedConfirmationId: 'x' }), null, now
      )).toBe(false);
    });
  });

  describe('有効なリース', () => {
    it('世代と採用確認IDが一致すれば有効(確認時刻は問わない)', () => {
      expect(isTorqueWrenchConfirmationFreshForAcquire(
        confirmation({ confirmedAt: at(-60 * 60_000) }), lease(), now
      )).toBe(true);
    });

    it('世代が異なれば無効', () => {
      expect(isTorqueWrenchConfirmationFreshForAcquire(confirmation(), lease({ generation: 4 }), now)).toBe(false);
    });

    it('採用確認IDが異なれば無効', () => {
      expect(isTorqueWrenchConfirmationFreshForAcquire(
        confirmation(), lease({ adoptedConfirmationId: 'conf-9' }), now
      )).toBe(false);
      expect(isTorqueWrenchConfirmationFreshForAcquire(
        confirmation(), lease({ adoptedConfirmationId: null }), now
      )).toBe(false);
    });
  });

  describe('期限切れ・解放済みリース', () => {
    it('expiresAt == now は期限切れとして扱い、期限より後の確認のみ有効', () => {
      const expired = lease({ expiresAt: now });
      expect(isTorqueWrenchConfirmationFreshForAcquire(confirmation({ confirmedAt: at(1) }), expired, now)).toBe(true);
      expect(isTorqueWrenchConfirmationFreshForAcquire(confirmation({ confirmedAt: now }), expired, now)).toBe(false);
      expect(isTorqueWrenchConfirmationFreshForAcquire(confirmation({ confirmedAt: at(-1) }), expired, now)).toBe(false);
    });

    it('解放済みなら解放時刻を境界にする(expiresAtが未来でも)', () => {
      const released = lease({ releasedAt: at(-10_000), expiresAt: at(60_000) });
      expect(isTorqueWrenchConfirmationFreshForAcquire(confirmation({ confirmedAt: at(-9_999) }), released, now)).toBe(true);
      expect(isTorqueWrenchConfirmationFreshForAcquire(confirmation({ confirmedAt: at(-10_000) }), released, now)).toBe(false);
    });

    it('境界後の確認でもスナップショット不一致なら無効', () => {
      const released = lease({ releasedAt: at(-10_000) });
      expect(isTorqueWrenchConfirmationFreshForAcquire(
        confirmation({ confirmedAt: at(-1), observedLeaseGeneration: 2 }), released, now
      )).toBe(false);
    });
  });
});

describe('isTorqueWrenchConfirmationActiveOwnerRetry', () => {
  const owner = { ownerClientDeviceId: 'kiosk-a', ownerSessionId: 'session-a', ownerKind: 'ASSEMBLY' };
  const adopted = confirmation({ id: 'conf-0' });

  it('同じ有効な所有者・端末・セッションで採用済み確認なら再試行を許可', () => {
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(adopted, lease(), owner, now)).toBe(true);
  });

  it('リースなし・解放済み・期限切れ(境界含む)は拒否', () => {
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(adopted, null, owner, now)).toBe(false);
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(adopted, lease({ releasedAt: at(-1) }), owner, now)).toBe(false);
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(adopted, lease({ expiresAt: now }), owner, now)).toBe(false);
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(adopted, lease({ expiresAt: at(1) }), owner, now)).toBe(true);
  });

  it('端末またはセッションが異なれば拒否', () => {
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(
      adopted, lease(), { ...owner, ownerClientDeviceId: 'kiosk-b' }, now
    )).toBe(false);
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(
      adopted, lease(), { ...owner, ownerSessionId: 'session-b' }, now
    )).toBe(false);
  });

  it('所有者種別は双方が指定されている場合のみ比較する', () => {
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(adopted, lease(), { ...owner, ownerKind: 'TRAINING' }, now)).toBe(false);
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(
      adopted, lease(), { ownerClientDeviceId: 'kiosk-a', ownerSessionId: 'session-a' }, now
    )).toBe(true);
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(
      adopted, lease({ ownerKind: undefined }), { ...owner, ownerKind: 'TRAINING' }, now
    )).toBe(true);
  });

  it('採用済みでない確認(別ID)は拒否', () => {
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(confirmation({ id: 'conf-1' }), lease(), owner, now)).toBe(false);
    expect(isTorqueWrenchConfirmationActiveOwnerRetry(adopted, lease({ adoptedConfirmationId: null }), owner, now)).toBe(false);
  });
});
