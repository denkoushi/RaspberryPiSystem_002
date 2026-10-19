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

export type CallState = 'idle' | 'ringing' | 'incoming' | 'connecting' | 'connected' | 'ended';

export interface CallInfo {
  callId: string;
  from: string;
  to: string;
  callerName?: string;
  callerLocation?: string | null;
}


export type WatchMessageType = 'watch.request' | 'watch.accept' | 'watch.accepted' | 'watch.deny' | 'watch.denied'
  | 'watch.stop' | 'watch.stopped' | 'watch.fail' | 'watch.signal' | 'watch.pointer';

export interface WatchMessage {
  type: WatchMessageType;
  payload: {
    watchId: string;
    viewerName?: string;
    reason?: string;
    // Stage 3/4: opaque SDP/ICE or normalized pointer data; never call signaling types.
    [key: string]: unknown;
  };
}
