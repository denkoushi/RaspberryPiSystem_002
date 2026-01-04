/**
 * WebRTCコール状態管理ストア
 * メモリ実装（将来Redis化可能なインターフェース）
 */

import type { CallState, CallParticipant } from './types.js';

export interface ICallStore {
  createCall(callId: string, from: string, to: string): CallState;
  getCall(callId: string): CallState | undefined;
  addParticipant(callId: string, participant: CallParticipant): void;
  removeParticipant(callId: string, clientId: string): void;
  updateCallState(callId: string, state: CallState['state']): void;
  deleteCall(callId: string): void;
  getCallByClientId(clientId: string): CallState | undefined;
}

/**
 * メモリ実装のCallStore
 */
class MemoryCallStore implements ICallStore {
  private calls = new Map<string, CallState>();

  createCall(callId: string, from: string, to: string): CallState {
    const call: CallState = {
      callId,
      from,
      to,
      state: 'ringing',
      createdAt: Date.now(),
      participants: new Map()
    };
    this.calls.set(callId, call);
    return call;
  }

  getCall(callId: string): CallState | undefined {
    return this.calls.get(callId);
  }

  addParticipant(callId: string, participant: CallParticipant): void {
    const call = this.calls.get(callId);
    if (!call) {
      throw new Error(`Call ${callId} not found`);
    }
    call.participants.set(participant.clientId, participant);
  }

  removeParticipant(callId: string, clientId: string): void {
    const call = this.calls.get(callId);
    if (!call) {
      return;
    }
    call.participants.delete(clientId);
    if (call.participants.size === 0) {
      this.calls.delete(callId);
    }
  }

  updateCallState(callId: string, state: CallState['state']): void {
    const call = this.calls.get(callId);
    if (!call) {
      return;
    }
    call.state = state;
  }

  deleteCall(callId: string): void {
    this.calls.delete(callId);
  }

  getCallByClientId(clientId: string): CallState | undefined {
    for (const call of this.calls.values()) {
      if (call.participants.has(clientId)) {
        return call;
      }
      if (call.from === clientId || call.to === clientId) {
        return call;
      }
    }
    return undefined;
  }
}

// シングルトンインスタンス
export const callStore: ICallStore = new MemoryCallStore();

