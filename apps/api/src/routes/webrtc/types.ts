/**
 * WebRTCシグナリングメッセージの型定義
 */

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: Buffer) => void): void;
  on(event: 'close', listener: () => void): void;
}

export interface SignalingMessage {
  type: 'invite' | 'incoming' | 'accept' | 'reject' | 'cancel' | 'hangup' | 'offer' | 'answer' | 'ice-candidate' | 'error';
  callId?: string; // コール識別子（invite時に生成）
  from?: string; // 発信者のclientId
  to?: string; // 受信者のclientId
  payload?: unknown; // SDP、ICE candidate、エラーメッセージなど
  timestamp?: number; // メッセージ送信時刻
}

export interface CallParticipant {
  clientId: string;
  socket: WebSocketLike;
  joinedAt: number;
}

export interface CallState {
  callId: string;
  from: string;
  to: string;
  state: 'ringing' | 'in_call' | 'ended';
  createdAt: number;
  participants: Map<string, CallParticipant>;
}

