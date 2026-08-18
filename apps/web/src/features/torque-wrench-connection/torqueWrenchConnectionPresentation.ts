import type { TorqueAgentLeaseStatus } from './torqueWrenchConnectionTransport';
import type { TorqueWrenchConnectionState } from './useTorqueWrenchConnection';

export type TorqueWrenchConnectionPresentation = {
  stateLabel: string;
  connectionMessage: string | null;
  safeToTighten: boolean;
};

export type ResolveTorqueWrenchConnectionPresentationInput = {
  state: TorqueWrenchConnectionState;
  currentTemplateBoltId: string | null;
  confirmationLookupState: 'idle' | 'loading' | 'resolved';
  hasConfirmation: boolean;
  reachability: 'unknown' | 'reachable' | 'unreachable';
  status: TorqueAgentLeaseStatus | null;
  error?: string | null;
};

function stateLabel(state: TorqueWrenchConnectionState): string {
  switch (state) {
    case 'acquiring': return '接続権を取得中';
    case 'owned_by_self': return 'Bluetooth接続待ち';
    case 'handoff_wait': return '引継ぎ待機中';
    case 'ready': return '入力待機中';
    case 'owned_by_other': return '別の作業または端末が使用中';
    case 'communication_lost': return '通信断';
    case 'recovering': return '復旧中';
    case 'fenced': return '接続権が移動済み';
    default: return '使用開始待ち';
  }
}

function activeMessage(input: ResolveTorqueWrenchConnectionPresentationInput): string | null {
  if (input.error) return input.error;
  if (input.reachability === 'unreachable') {
    return 'torque-agentとの通信が切れました。接続状態を確認してください。';
  }
  if (!input.currentTemplateBoltId || !input.hasConfirmation) return null;
  if (input.state === 'owned_by_other') {
    return '別の作業または端末が使用中です。現物が手元にある場合だけ引継ぎ操作を行ってください。';
  }
  if (input.state === 'handoff_wait') return '旧端末のBluetooth停止を待っています。';
  if (input.state === 'communication_lost') {
    return 'Pi 5との通信が切れたため接続を停止しました。もう一度「このレンチを使用開始」を押してください。';
  }
  if (input.state === 'recovering') {
    return '安全停止を確認しています。接続が戻るまで締め付けないでください。';
  }
  if (input.state === 'fenced') {
    return '接続権が別端末へ移動しました。もう一度使用する場合は「このレンチを使用開始」を押してください。';
  }
  if (input.status?.state === 'expired') {
    return '接続権の期限が切れました。もう一度「このレンチを使用開始」を押してください。';
  }
  if (input.status?.lastError === 'BROWSER_DISARMED') return null;
  if (input.status?.lastError) {
    return `トルクレンチ接続を開始できませんでした: ${input.status.lastError}`;
  }
  if (input.state === 'owned_by_self') {
    return '接続権を取得しました。Bluetooth接続を待っています。';
  }
  return null;
}

/** Pure state-to-copy mapping used by both assembly and training pages. */
export function resolveTorqueWrenchConnectionPresentation(
  input: ResolveTorqueWrenchConnectionPresentationInput
): TorqueWrenchConnectionPresentation {
  if (!input.currentTemplateBoltId) {
    return { stateLabel: '待機中', connectionMessage: null, safeToTighten: false };
  }
  if (input.reachability === 'unreachable' && !input.hasConfirmation) {
    return {
      stateLabel: '通信断',
      connectionMessage: activeMessage(input),
      safeToTighten: false
    };
  }
  if (input.confirmationLookupState !== 'resolved') {
    return { stateLabel: '確認状態を読込中', connectionMessage: null, safeToTighten: false };
  }
  if (!input.hasConfirmation) {
    return { stateLabel: '現物確認待ち', connectionMessage: null, safeToTighten: false };
  }
  return {
    stateLabel: stateLabel(input.state),
    connectionMessage: activeMessage(input),
    // handoff_wait deliberately does not satisfy the ready condition.
    safeToTighten: input.state === 'ready'
  };
}
