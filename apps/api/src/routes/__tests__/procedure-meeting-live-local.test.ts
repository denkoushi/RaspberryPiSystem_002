import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { websocketOptions } from '../../lib/websocket-options.js';
import type { LiveMessage, LiveSession } from '../../services/assembly/procedure-meeting-live/live-session.js';
import { registerProcedureMeetingLiveRoutes, type LiveUpstream } from '../assembly/procedure-meeting-live.js';

vi.mock('../../config/env.js', () => ({ env: { PROCEDURE_SPEECH_TO_TEXT_ENABLED: true } }));
vi.mock('../../services/clients/client-device-auth.service.js', () => ({
  findClientDeviceIdRecordByApiKey: async (key: string) => (key === 'good' ? { id: 'dev' } : null)
}));
vi.mock('../../services/inference/inference-runtime.js', () => ({
  getInferenceRuntime: () => ({ router: { resolve: () => ({ provider: { baseUrl: 'https://dgx.example:8443', sharedToken: 't' } }) } })
}));

class FakeSession implements LiveSession {
  pushed: Buffer[] = []; terms: string[] = []; ended = false; closed = false;
  constructor(public emit: (m: LiveMessage) => void) {}
  setTerms(t: string) { this.terms.push(t); }
  push(b: Buffer) { this.pushed.push(b); }
  async end() { this.emit({ type: 'final', id: 1, text: '最後' }); this.emit({ type: 'done' }); this.ended = true; }
  close() { this.closed = true; }
}

const tick = () => new Promise((r) => setTimeout(r, 40));
let app: ReturnType<typeof Fastify>;
let sessions: FakeSession[];
let upstreamStatus: number;
let sttOk: boolean;
const connect = async (query: string) => {
  const received: string[] = [];
  const ws = await app.injectWS(`/assembly/procedure-documents/meeting-live?clientKey=good${query}`, {}, {
    onInit: (socket) => { socket.on('message', (d) => received.push(d.toString())); }
  });
  return { ws, received };
};

beforeEach(async () => {
  sessions = [];
  upstreamStatus = 404;
  sttOk = true;
  app = Fastify();
  await app.register(websocket, websocketOptions);
  registerProcedureMeetingLiveRoutes(app, { allowWriteKiosk: async () => {} }, {
    fetchImpl: (async () => ({ status: upstreamStatus })) as unknown as typeof fetch,
    sttHealthy: async () => sttOk,
    sessionFactory: ({ emit }) => { const s = new FakeSession(emit); sessions.push(s); return s; },
    upstreamFactory: (() => { throw new Error('no upstream'); }) as unknown as () => LiveUpstream
  });
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('local live mode', () => {
  it('v2 sends typed messages, accepts context, and finishes with done', async () => {
    const ws = await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=good&v=2');
    const received: string[] = [];
    ws.on('message', (d) => received.push(d.toString()));
    ws.send(JSON.stringify({ type: 'context', terms: 'ねじ M6' }));
    ws.send(Buffer.from([1, 2]), { binary: true });
    ws.send('end');
    await tick();
    expect(sessions[0].terms).toEqual(['ねじ M6']);
    expect(sessions[0].pushed).toHaveLength(1);
    expect(received.map((r) => JSON.parse(r))).toEqual([{ type: 'final', id: 1, text: '最後' }, { type: 'done' }]);
    expect(sessions[0].closed).toBe(true);
  });

  it('old protocol gets only finals in the legacy shape', async () => {
    const ws = await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=good');
    const received: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => received.push(JSON.parse(d.toString())));
    ws.send('end');
    await tick();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ spk: 0, text: '最後' });
    expect(received[0]).not.toHaveProperty('type');
  });

  it('allows one local session at a time and frees the slot afterwards', async () => {
    const first = await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=good&v=2');
    await tick();
    const { received } = await connect('&v=2');
    await tick();
    expect(received.map((r) => JSON.parse(r))).toEqual([{ type: 'error', error: 'busy' }]);
    first.terminate();
    await new Promise((r) => setTimeout(r, 100));
    const third = await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=good&v=2');
    await tick();
    expect(sessions).toHaveLength(2);
    third.terminate();
  });

  it('busy reply uses the legacy shape without v=2', async () => {
    await app.injectWS('/assembly/procedure-documents/meeting-live?clientKey=good');
    await tick();
    const { received } = await connect('');
    await tick();
    expect(received).toEqual(['{"error":"busy"}']);
  });

  it('is unavailable when neither upstream nor speech-to-text is up', async () => {
    sttOk = false;
    const { received } = await connect('&v=2');
    await tick();
    expect(received.map((r) => JSON.parse(r))).toEqual([{ type: 'error', error: 'unavailable' }]);
  });

  it('availability follows speech-to-text health when upstream is gone', async () => {
    const res = await app.inject({ method: 'GET', url: '/assembly/procedure-documents/meeting-live/availability' });
    expect(res.json()).toEqual({ available: true });
  });
});
