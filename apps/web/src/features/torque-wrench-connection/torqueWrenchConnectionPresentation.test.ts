import { describe, expect, it } from 'vitest';

import { resolveTorqueWrenchConnectionPresentation } from './torqueWrenchConnectionPresentation';

import type { TorqueAgentLeaseStatus } from './torqueWrenchConnectionTransport';

function status(overrides: Partial<TorqueAgentLeaseStatus> = {}): TorqueAgentLeaseStatus {
  return {
    ok: true,
    ready: false,
    state: 'available',
    owner: null,
    bound: false,
    leaseOwned: false,
    bluetoothPowered: false,
    hidExclusive: false,
    lastError: null,
    ...overrides
  };
}

describe('resolveTorqueWrenchConnectionPresentation', () => {
  const base = {
    currentTemplateBoltId: 'bolt-1',
    confirmationLookupState: 'resolved' as const,
    hasConfirmation: true,
    reachability: 'reachable' as const
  };

  it('keeps handoff_wait unsafe even when a stale agent says ready', () => {
    expect(resolveTorqueWrenchConnectionPresentation({
      ...base,
      state: 'handoff_wait',
      status: status({ state: 'handoff_wait', ready: true, leaseOwned: true })
    })).toMatchObject({ stateLabel: '引継ぎ待機中', safeToTighten: false });
  });

  it('renders the recovering safe-stop message before Bluetooth wait', () => {
    expect(resolveTorqueWrenchConnectionPresentation({
      ...base,
      state: 'recovering',
      status: status({ state: 'owned_by_self', leaseOwned: true })
    })).toMatchObject({
      stateLabel: '復旧中',
      connectionMessage: '安全停止を確認しています。接続が戻るまで締め付けないでください。',
      safeToTighten: false
    });
  });

  it('requires an explicit start after a fenced token', () => {
    expect(resolveTorqueWrenchConnectionPresentation({
      ...base,
      state: 'fenced',
      status: status({ state: 'fenced', lastError: 'TORQUE_WRENCH_LEASE_FENCED' })
    })).toMatchObject({
      stateLabel: '接続権が移動済み',
      safeToTighten: false
    });
  });
});
