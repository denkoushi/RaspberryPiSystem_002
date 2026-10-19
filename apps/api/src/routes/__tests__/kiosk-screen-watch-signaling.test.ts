import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signalingRegistry } from '../../services/kiosk-screen-watch/signaling-registry.js';
import { callStore } from '../webrtc/call-store.js';
import { registerWebRTCSignaling } from '../webrtc/signaling.js';

const handle = vi.hoisted(() => vi.fn());
vi.mock('../../services/kiosk-screen-watch/kiosk-screen-watch.service.js', () => ({ kioskScreenWatchService: { handle } }));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  findClientDeviceIdRecordByApiKey: async (key: string) => ({ id: key }),
  findClientDeviceProfileById: async (id: string) => ({ id, name: id, location: null })
}));
function socket() {
  const listeners = new Map<string, (data?: Buffer) => Promise<void>>();
  return {
    readyState: 1, send: vi.fn(), close: vi.fn(),
    on: (event: string, listener: (data?: Buffer) => Promise<void>) => { listeners.set(event, listener); },
    receive: (message: unknown) => listeners.get('message')!(Buffer.from(JSON.stringify(message))),
    disconnect: () => listeners.get('close')!()
  };
}
const read = (s: ReturnType<typeof socket>) => s.send.mock.calls.map(([data]) => JSON.parse(data));
let viewer: ReturnType<typeof socket>;
let target: ReturnType<typeof socket>;
beforeEach(async () => {
  handle.mockReset().mockResolvedValue(undefined);
  let connect!: (s: ReturnType<typeof socket>, req: unknown) => Promise<void>;
  registerWebRTCSignaling({
    get: (_path: string, _options: unknown, handler: typeof connect) => { connect = handler; },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as FastifyInstance);
  viewer = socket(); target = socket();
  await connect(viewer, { url: '/signaling', headers: { 'x-client-key': 'viewer' }, query: {} });
  await connect(target, { url: '/signaling', headers: { 'x-client-key': 'target' }, query: {} });
});
afterEach(async () => {
  await viewer.disconnect(); await target.disconnect();
});

describe('single signaling socket routes', () => {
  it('dispatches watch messages with the authenticated device and never starts a call', async () => {
    const message = { type: 'watch.accept', payload: { watchId: 'watch' }, from: 'spoofed' };
    await target.receive(message);
    expect(handle).toHaveBeenCalledWith('target', message);
    expect(callStore.getCallByClientId('target')).toBeUndefined();
  });
  it('returns an error for a rejected watch party without forwarding', async () => {
    handle.mockRejectedValueOnce(new Error('Unauthorized watch participant'));
    await viewer.receive({ type: 'watch.accept', payload: { watchId: 'watch' } });
    expect(read(viewer)).toEqual([{ type: 'error', payload: { watchId: 'watch', message: 'Unauthorized watch participant' } }]);
    expect(target.send).not.toHaveBeenCalled();
  });
  it('preserves call invite, accept, SDP relay and hangup behavior', async () => {
    await viewer.receive({ type: 'invite', to: 'target' });
    const incoming = read(target).at(-1);
    expect(incoming).toMatchObject({ type: 'incoming', from: 'viewer', to: 'target', payload: { callerName: 'viewer' } });
    const callId = incoming.callId;
    await target.receive({ type: 'accept', callId });
    expect(read(viewer).at(-1)).toMatchObject({ type: 'accept', callId });
    await viewer.receive({ type: 'offer', callId, payload: { sdp: 'call-sdp' } });
    expect(read(target).at(-1)).toMatchObject({ type: 'offer', callId, from: 'viewer', to: 'target', payload: { sdp: 'call-sdp' } });
    await target.receive({ type: 'hangup', callId });
    expect(read(viewer).at(-1)).toMatchObject({ type: 'hangup', callId });
    expect(callStore.getCall(callId)).toBeUndefined(); expect(handle).not.toHaveBeenCalled();
  });
  it('preserves ping and call disconnect notification', async () => {
    await viewer.receive({ type: 'ping', payload: { timestamp: 123 } });
    expect(read(viewer).at(-1)).toEqual({ type: 'pong', timestamp: 123 });
    await viewer.receive({ type: 'invite', to: 'target' });
    await viewer.disconnect();
    expect(read(target).at(-1)?.type).toBe('hangup');
    expect(signalingRegistry.isOnline('viewer')).toBe(false);
  });
});
