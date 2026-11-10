import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryCallStore, RINGING_TTL_MS } from '../webrtc/call-store.js';

describe('call lifetime', () => {
  let store: MemoryCallStore;
  beforeEach(() => { vi.useFakeTimers(); store = new MemoryCallStore(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('allows one ringing outgoing call per device and permits a new call after deletion', () => {
    store.createCall('first', 'caller', 'callee');
    expect(() => store.createCall('second', 'caller', 'other')).toThrow('Caller already has a ringing call');
    expect(store.getCall('first')).toMatchObject({ state: 'ringing' });
    expect(store.getCall('second')).toBeUndefined();
    store.deleteCall('first');
    expect(store.createCall('second', 'caller', 'other')).toMatchObject({ state: 'ringing' });
  });

  it('expires ringing at 60 seconds and frees the caller', () => {
    store.createCall('first', 'caller', 'callee');
    vi.advanceTimersByTime(RINGING_TTL_MS - 1);
    expect(store.getCall('first')).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(store.getCall('first')).toBeUndefined();
    expect(store.getCallsByClientId('callee')).toEqual([]);
    expect(store.createCall('second', 'caller', 'callee')).toBeDefined();
  });

  it('reports an expired ringing call once so both devices can be told', () => {
    const expired: string[] = [];
    store.setRingingExpiredHandler(call => expired.push(`${call.callId}:${call.from}->${call.to}`));
    store.createCall('first', 'caller', 'callee');
    vi.advanceTimersByTime(RINGING_TTL_MS);
    expect(store.getCall('first')).toBeUndefined();
    expect(expired).toEqual(['first:caller->callee']);
  });

  it('does not report calls that were answered or ended before the deadline', () => {
    const expired: string[] = [];
    store.setRingingExpiredHandler(call => expired.push(call.callId));
    store.createCall('answered', 'caller', 'callee');
    store.updateCallState('answered', 'in_call');
    store.createCall('ended', 'other', 'callee');
    store.deleteCall('ended');
    vi.advanceTimersByTime(RINGING_TTL_MS * 2);
    expect(expired).toEqual([]);
  });

  it('preserves accepted calls after the ringing deadline', () => {
    store.createCall('accepted', 'caller', 'callee');
    store.updateCallState('accepted', 'in_call');
    vi.advanceTimersByTime(RINGING_TTL_MS * 2);
    expect(store.getCall('accepted')).toMatchObject({ state: 'in_call' });
  });

  it('finds every incoming and outgoing call involving a device', () => {
    store.createCall('outgoing', 'caller', 'callee');
    store.createCall('incoming', 'other', 'caller');
    expect(store.getCallsByClientId('caller').map(call => call.callId)).toEqual(['outgoing', 'incoming']);
    expect(store.getCallsByClientId('unrelated')).toEqual([]);
  });
});
