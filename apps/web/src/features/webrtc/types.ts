/**
 * WebRTCシグナリングメッセージの型定義
 */

export interface SignalingMessage {
  type: 'invite' | 'incoming' | 'accept' | 'reject' | 'cancel' | 'hangup' | 'offer' | 'answer' | 'ice-candidate' | 'error' | 'ping' | 'pong' | WatchMessageType;
  callId?: string;
  from?: string;
  to?: string;
  payload?: unknown;
  timestamp?: number;
}

export interface IncomingCallPayload {
  callerName?: string;
  callerLocation?: string | null;
}

export interface CallInfo {
  callId: string;
  from: string;
  to: string;
  callerName?: string;
  callerLocation?: string | null;
}


export type WatchMessageType = 'watch.request' | 'watch.accept' | 'watch.accepted' | 'watch.deny' | 'watch.denied'
  | 'watch.stop' | 'watch.stopped' | 'watch.fail' | 'watch.signal' | 'watch.pointer'
  | 'watch.control.request' | 'watch.control.accept' | 'watch.control.accepted' | 'watch.control.deny' | 'watch.control.denied'
  | 'watch.control.stop' | 'watch.control.stopped' | 'watch.input';

export interface WatchMessage {
  type: WatchMessageType;
  payload: {
    watchId: string;
    viewerName?: string;
    reason?: string;
    // Opaque SDP/ICE, normalized pointer data or remote input.
    [key: string]: unknown;
  };
}
