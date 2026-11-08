/**
 * WebRTCコール状態管理ストア
 * メモリ実装（将来Redis化可能なインターフェース）
 */

import type { CallState, CallParticipant } from './types.js';

export const RINGING_TTL_MS = 60_000;

export interface ICallStore {
  createCall(callId: string, from: string, to: string): CallState;
  getCall(callId: string): CallState | undefined;
  addParticipant(callId: string, participant: CallParticipant): void;
  removeParticipant(callId: string, clientId: string): void;
  updateCallState(callId: string, state: CallState['state']): void;
  deleteCall(callId: string): void;
  getCallByClientId(clientId: string): CallState | undefined;
  getCallsByClientId(clientId: string): CallState[];
  setRingingExpiredHandler(handler: ((call: CallState) => void) | undefined): void;
}

/**
 * メモリ実装のCallStore
 */
export class MemoryCallStore implements ICallStore {
  private ringingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private calls = new Map<string, CallState>();
  private ringingExpiredHandler: ((call: CallState) => void) | undefined;

  setRingingExpiredHandler(handler: ((call: CallState) => void) | undefined): void {
    this.ringingExpiredHandler = handler;
  }

  private expireRingingCall(callId: string): void {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'ringing') return;
    this.deleteCall(callId);
    this.ringingExpiredHandler?.(call);
  }

  createCall(callId: string, from: string, to: string): CallState {
    if (this.getCallsByClientId(from).some(call => call.from === from && call.state === 'ringing')) {
      throw new Error('Caller already has a ringing call');
    }
    const call: CallState = {
      callId,
      from,
      to,
      state: 'ringing',
      createdAt: Date.now(),
      participants: new Map()
    };
    this.calls.set(callId, call);
    const timer = setTimeout(() => this.expireRingingCall(callId), RINGING_TTL_MS);
    timer.unref();
    this.ringingTimers.set(callId, timer);
    return call;
  }

  getCall(callId: string): CallState | undefined {
    const call = this.calls.get(callId);
    if (call?.state === 'ringing' && Date.now() - call.createdAt >= RINGING_TTL_MS) {
      this.expireRingingCall(callId);
      return undefined;
    }
    return call;
  }

  addParticipant(callId: string, participant: CallParticipant): void {
    const call = this.getCall(callId);
    if (!call) {
      throw new Error(`Call ${callId} not found`);
    }
    call.participants.set(participant.clientId, participant);
  }

  removeParticipant(callId: string, clientId: string): void {
    const call = this.getCall(callId);
    if (!call) {
      return;
    }
    call.participants.delete(clientId);
    if (call.participants.size === 0) {
      this.deleteCall(callId);
    }
  }

  updateCallState(callId: string, state: CallState['state']): void {
    const call = this.getCall(callId);
    if (!call) {
      return;
    }
    call.state = state;
    if (state !== 'ringing') this.clearRingingTimer(callId);
  }

  private clearRingingTimer(callId: string): void {
    clearTimeout(this.ringingTimers.get(callId));
    this.ringingTimers.delete(callId);
  }

  deleteCall(callId: string): void {
    this.clearRingingTimer(callId);
    this.calls.delete(callId);
  }

  getCallByClientId(clientId: string): CallState | undefined {
    return this.getCallsByClientId(clientId)[0];
  }

  getCallsByClientId(clientId: string): CallState[] {
    const calls: CallState[] = [];
    for (const callId of this.calls.keys()) {
      const call = this.getCall(callId);
      if (call && (call.from === clientId || call.to === clientId || call.participants.has(clientId))) {
        calls.push(call);
      }
    }
    return calls;
  }
}

// シングルトンインスタンス
export const callStore: ICallStore = new MemoryCallStore();

