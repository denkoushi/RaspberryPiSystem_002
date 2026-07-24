import type { TorqueAgentLeaseStatus } from './torqueAgentClient';

export type TorqueAgentReachability = 'unknown' | 'reachable' | 'unreachable';
export type TorqueConfirmationLookupState = 'idle' | 'loading' | 'resolved';

export type TorqueConnectionPresentation = {
  stateLabel: string;
  connectionMessage: string | null;
};

type TorqueConnectionPresentationInput = {
  currentTemplateBoltId: string | null;
  confirmationLookupState: TorqueConfirmationLookupState;
  hasConfirmation: boolean;
  reachability: TorqueAgentReachability;
  status: TorqueAgentLeaseStatus | null;
};

function activeLeaseStateLabel(status: TorqueAgentLeaseStatus): string | null {
  if (status.state === 'owned_by_other') return '別の作業または端末が使用中';
  if (status.state === 'handoff_wait') return '引継ぎ待機中';
  if (status.state === 'communication_lost') return '通信断';
  if (status.state === 'fenced') return '接続権が移動済み';
  if (status.ready) return '入力待機中';
  if (status.leaseOwned) return 'Bluetooth接続待ち';
  return null;
}

function connectionMessage(
  input: TorqueConnectionPresentationInput
): string | null {
  if (input.reachability === 'unreachable') {
    return 'torque-agentとの通信が切れました。接続状態を確認してください。';
  }
  if (!input.currentTemplateBoltId || !input.hasConfirmation || !input.status) return null;
  if (input.status.state === 'owned_by_other') {
    return '別の作業または端末が使用中です。現物が手元にある場合だけ引継ぎ操作を行ってください。';
  }
  if (input.status.state === 'handoff_wait') return '旧端末のBluetooth停止を待っています。';
  if (input.status.state === 'communication_lost') {
    return 'Pi 5との通信が切れたため接続を停止しました。もう一度「このレンチを使用開始」を押してください。';
  }
  if (input.status.state === 'fenced') {
    return '接続権が別端末へ移動しました。もう一度使用する場合は「このレンチを使用開始」を押してください。';
  }
  if (input.status.state === 'expired') {
    return '接続権の期限が切れました。もう一度「このレンチを使用開始」を押してください。';
  }
  if (input.status.lastError === 'BROWSER_DISARMED') return null;
  if (input.status.lastError) {
    return `トルクレンチ接続を開始できませんでした: ${input.status.lastError}`;
  }
  if (input.status.leaseOwned && !input.status.ready) {
    return '接続権を取得しました。Bluetooth接続を待っています。';
  }
  return null;
}

export function resolveTorqueConnectionPresentation(
  input: TorqueConnectionPresentationInput
): TorqueConnectionPresentation {
  if (input.reachability === 'unreachable') {
    return {
      stateLabel: '通信断',
      connectionMessage: connectionMessage(input)
    };
  }
  if (!input.currentTemplateBoltId) {
    return {
      stateLabel: '待機中',
      connectionMessage: connectionMessage(input)
    };
  }
  if (input.confirmationLookupState !== 'resolved') {
    return {
      stateLabel: '確認状態を読込中',
      connectionMessage: null
    };
  }
  if (!input.hasConfirmation) {
    return {
      stateLabel: '現物確認待ち',
      connectionMessage: null
    };
  }

  const leaseStateLabel = input.status ? activeLeaseStateLabel(input.status) : null;
  return {
    stateLabel: leaseStateLabel ?? '使用開始待ち',
    connectionMessage: connectionMessage(input)
  };
}
