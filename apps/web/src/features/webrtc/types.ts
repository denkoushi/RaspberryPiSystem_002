/**
 * WebRTCシグナリングメッセージの型定義
 */

export interface SignalingMessage {
  type: 'invite' | 'incoming' | 'accept' | 'reject' | 'cancel' | 'hangup' | 'offer' | 'answer' | 'ice-candidate' | 'error' | 'ping' | 'pong';
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

