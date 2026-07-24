import { describe, expect, it } from 'vitest';

import { resolveTorqueConnectionPresentation } from './assemblyTorqueConnectionPresentation';

import type { TorqueAgentLeaseStatus } from './torqueAgentClient';

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

describe('resolveTorqueConnectionPresentation', () => {
  it.each([
    {
      name: 'confirmation lookup has not started',
      input: {
        currentTemplateBoltId: 'bolt-1',
        confirmationLookupState: 'idle' as const,
        hasConfirmation: false,
        reachability: 'unknown' as const,
        status: null
      },
      label: '確認状態を読込中'
    },
    {
      name: 'confirmation lookup has not completed',
      input: {
        currentTemplateBoltId: 'bolt-1',
        confirmationLookupState: 'loading' as const,
        hasConfirmation: false,
        reachability: 'unknown' as const,
        status: null
      },
      label: '確認状態を読込中'
    },
    {
      name: 'physical confirmation is required while reachability is still unknown',
      input: {
        currentTemplateBoltId: 'bolt-1',
        confirmationLookupState: 'resolved' as const,
        hasConfirmation: false,
        reachability: 'unknown' as const,
        status: null
      },
      label: '現物確認待ち'
    },
    {
      name: 'a stale local lease snapshot is ignored before physical confirmation',
      input: {
        currentTemplateBoltId: 'bolt-1',
        confirmationLookupState: 'resolved' as const,
        hasConfirmation: false,
        reachability: 'reachable' as const,
        status: status({
          state: 'owned_by_other',
          owner: { clientDeviceName: 'StoneBase', clientDeviceLocation: '1F' }
        })
      },
      label: '現物確認待ち'
    },
    {
      name: 'explicit start is required after confirmation',
      input: {
        currentTemplateBoltId: 'bolt-1',
        confirmationLookupState: 'resolved' as const,
        hasConfirmation: true,
        reachability: 'reachable' as const,
        status: status()
      },
      label: '使用開始待ち'
    },
    {
      name: 'no current tightening position is idle',
      input: {
        currentTemplateBoltId: null,
        confirmationLookupState: 'idle' as const,
        hasConfirmation: false,
        reachability: 'reachable' as const,
        status: status({ lastError: 'BROWSER_DISARMED' })
      },
      label: '待機中'
    }
  ])('renders neutral state for $name', ({ input, label }) => {
    expect(resolveTorqueConnectionPresentation(input)).toEqual({
      stateLabel: label,
      connectionMessage: null
    });
  });

  it('renders communication loss only after an observed request failure', () => {
    expect(resolveTorqueConnectionPresentation({
      currentTemplateBoltId: 'bolt-1',
      confirmationLookupState: 'resolved',
      hasConfirmation: false,
      reachability: 'unreachable',
      status: null
    })).toEqual({
      stateLabel: '通信断',
      connectionMessage: 'torque-agentとの通信が切れました。接続状態を確認してください。'
    });
  });

  it.each([
    {
      name: 'another owner',
      overrides: {
        state: 'owned_by_other' as const,
        owner: { clientDeviceName: 'StoneBase', clientDeviceLocation: '1F' },
        lastError: 'TORQUE_WRENCH_LEASE_HELD'
      },
      label: '別の作業または端末が使用中',
      message: '別の作業または端末が使用中です。現物が手元にある場合だけ引継ぎ操作を行ってください。'
    },
    {
      name: 'handoff wait',
      overrides: { state: 'handoff_wait' as const, leaseOwned: true },
      label: '引継ぎ待機中',
      message: '旧端末のBluetooth停止を待っています。'
    },
    {
      name: 'fenced',
      overrides: { state: 'fenced' as const, lastError: 'TORQUE_WRENCH_LEASE_FENCED' },
      label: '接続権が移動済み',
      message: '接続権が別端末へ移動しました。もう一度使用する場合は「このレンチを使用開始」を押してください。'
    },
    {
      name: 'Bluetooth wait',
      overrides: { state: 'owned_by_self' as const, leaseOwned: true },
      label: 'Bluetooth接続待ち',
      message: '接続権を取得しました。Bluetooth接続を待っています。'
    },
    {
      name: 'ready',
      overrides: {
        state: 'owned_by_self' as const,
        leaseOwned: true,
        ready: true,
        bluetoothPowered: true,
        hidExclusive: true
      },
      label: '入力待機中',
      message: null
    }
  ])('preserves the active lease presentation for $name', ({ overrides, label, message }) => {
    expect(resolveTorqueConnectionPresentation({
      currentTemplateBoltId: 'bolt-1',
      confirmationLookupState: 'resolved',
      hasConfirmation: true,
      reachability: 'reachable',
      status: status(overrides)
    })).toEqual({
      stateLabel: label,
      connectionMessage: message
    });
  });

  it('keeps the Pi 5 communication-loss explanation distinct from loopback failure', () => {
    expect(resolveTorqueConnectionPresentation({
      currentTemplateBoltId: 'bolt-1',
      confirmationLookupState: 'resolved',
      hasConfirmation: true,
      reachability: 'reachable',
      status: status({
        state: 'communication_lost',
        lastError: 'LEASE_RENEW_FAILED'
      })
    })).toEqual({
      stateLabel: '通信断',
      connectionMessage: 'Pi 5との通信が切れたため接続を停止しました。もう一度「このレンチを使用開始」を押してください。'
    });
  });
});
