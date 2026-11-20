import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { websocketOptions } from '../../lib/websocket-options.js';
import {
  registerProcedureMeetingLiveRoutes, isMeetingLiveAvailable, type LiveUpstream
} from '../assembly/procedure-meeting-live.js';

const mocks = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../config/env.js', () => ({ env: { get PROCEDURE_SPEECH_TO_TEXT_ENABLED() { return mocks.enabled; } } }));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  findClientDeviceIdRecordByApiKey: async (key: string) => (key === 'good' ? { id: 'dev' } : null)
}));
vi.mock('../../services/inference/inference-runtime.js', () => ({
  getInferenceRuntime: () => ({ router: { resolve: () => ({ provider: { baseUrl: 'https://dgx.example:8443', sharedToken: 't' } }) } })
}));

class FakeUpstream implements LiveUpstream {
  readyState = 0; binaryType = ''; sent: unknown[] = []; closed = false;
  private l: Record<string, Array<(e?: never) => void>> = {};
  constructor(public url: string) {}
  send(data: unknown) { this.sent.push(data); }
  close() { this.closed = true; this.fire('close'); }
  addEventListener(type: string, fn: (e?: never) => void) { (this.l[type] ??= []).push(fn); }
  fire(type: string, event?: unknown) { for (const fn of this.l[type] ?? []) fn(event as never); }
  open() { this.readyState = 1; this.fire('open'); }
}

let app: ReturnType<typeof Fastify>;
let upstreams: FakeUpstream[];
let fetchImpl: ReturnType<typeof vi.fn>;
const tick = () => new Promise(r => setTimeout(r, 30));

beforeEach(async () => {
  mocks.enabled = true;
  upstreams = [];
  fetchImpl = vi.fn();
  app = Fastify();
  await app.register(websocket, websocketOptions);
  registerProcedureMeetingLiveRoutes(app, { allowWriteKiosk: async () => {} }, {
    upstreamFactory: (url) => { const u = new FakeUpstream(url); upstreams.push(u); return u; },
    fetchImpl: fetchImpl as unknown as typeof fetch
  });
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('meeting-live websocket', () => {
  it('rejects an invalid client key without opening upstream', async () => {
    const ws = await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=bad');
    const code = await new Promise(r => ws.once('close', c => r(c)));
    expect(code).toBe(1008);
    expect(upstreams).toHaveLength(0);
  });

  it('relays audio up (buffered until open), end, and results down', async () => {
    const ws = await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=good');
    const received: string[] = [];
    ws.on('message', d => received.push(d.toString()));
    ws.send(Buffer.from([1, 2, 3, 4]), { binary: true });
    await tick();
    expect(upstreams[0].url).toBe('wss://dgx.example:8443/ws');
    expect(upstreams[0].binaryType).toBe('arraybuffer');
    expect(upstreams[0].sent).toHaveLength(0);
    upstreams[0].open();
    expect(upstreams[0].sent).toHaveLength(1);
    ws.send(Buffer.from([5, 6]), { binary: true });
    ws.send('end');
    ws.send('other');
    await tick();
    expect(upstreams[0].sent).toHaveLength(3);
    expect(upstreams[0].sent[2]).toBe('end');
    expect(upstreams[0].closed).toBe(false);
    upstreams[0].fire('message', { data: '{"spk":0,"text":"hi","t":1}' });
    await tick();
    expect(received).toEqual(['{"spk":0,"text":"hi","t":1}']);
    const closed = new Promise(r => ws.once('close', () => r(true)));
    upstreams[0].close();
    expect(await closed).toBe(true);
  });

  it('closes upstream immediately when the browser closes', async () => {
    const ws = await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=good');
    await tick();
    upstreams[0].open();
    ws.terminate();
    await new Promise(r => setTimeout(r, 100));
    expect(upstreams[0].closed).toBe(true);
  });

  it('reports unavailable when upstream fails to connect', async () => {
    const ws = await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=good');
    const received: string[] = [];
    ws.on('message', d => received.push(d.toString()));
    await tick();
    upstreams[0].fire('error');
    await tick();
    expect(received).toEqual(['{"error":"unavailable"}']);
  });
});

describe('meeting-live availability', () => {
  it('is true only for status 400', async () => {
    fetchImpl.mockResolvedValue({ status: 400 });
    expect(await isMeetingLiveAvailable(fetchImpl as unknown as typeof fetch)).toBe(true);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://dgx.example:8443/ws');
    const res = await app.inject({ method: 'GET', url: '/assembly/procedure-documents/meeting-live/availability' });
    expect(res.json()).toEqual({ available: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('is false for 404, errors, and when disabled', async () => {
    fetchImpl.mockResolvedValue({ status: 404 });
    expect(await isMeetingLiveAvailable(fetchImpl as unknown as typeof fetch)).toBe(false);
    fetchImpl.mockRejectedValue(new Error('x'));
    expect(await isMeetingLiveAvailable(fetchImpl as unknown as typeof fetch)).toBe(false);
    fetchImpl.mockResolvedValue({ status: 400 });
    mocks.enabled = false;
    expect(await isMeetingLiveAvailable(fetchImpl as unknown as typeof fetch)).toBe(false);
  });
});
