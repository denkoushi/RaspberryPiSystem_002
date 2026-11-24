import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import { env } from '../../config/env.js';
import { normalizeClientKey } from '../../lib/client-key.js';
import { findClientDeviceIdRecordByApiKey } from '../../services/clients/client-device-auth.service.js';
import { defaultComplete, defaultSttHealthy, defaultTranscribe } from '../../services/assembly/procedure-meeting-live/default-deps.js';
import { LiveMeetingSession, type LiveMessage, type LiveSession } from '../../services/assembly/procedure-meeting-live/live-session.js';
import { getInferenceRuntime } from '../../services/inference/inference-runtime.js';

export const MEETING_LIVE_PATH = '/assembly/procedure-documents/meeting-live';
const BUFFER_LIMIT_BYTES = 2 * 1024 * 1024;

function messageByteLength(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Array.isArray(data)) return data.reduce((sum: number, part) => sum + messageByteLength(part), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}
const WS_OPEN = 1;
const AVAILABILITY_TTL_MS = 30000;
const TERMS_MAX_CHARS = 200;

export type LocalSessionFactory = (opts: { emit: (message: LiveMessage) => void; terms: string }) => LiveSession;
const defaultSessionFactory: LocalSessionFactory = ({ emit, terms }) =>
  new LiveMeetingSession({ transcribe: defaultTranscribe, complete: defaultComplete, emit, terms });

/** Minimal browser-style WebSocket surface used for the upstream (injectable for tests). */
export interface LiveUpstream {
  readonly readyState: number;
  binaryType: string;
  send(data: ArrayBuffer | Uint8Array | string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
export type LiveUpstreamFactory = (url: string) => LiveUpstream;

function resolveBaseUrl(): string | null {
  if (!env.PROCEDURE_SPEECH_TO_TEXT_ENABLED) return null;
  try {
    const { provider } = getInferenceRuntime().router.resolve('business_hermes');
    return provider.baseUrl || null;
  } catch {
    return null;
  }
}

function liveUrl(baseUrl: string, scheme: 'http' | 'ws'): string {
  const url = new URL('/ws', baseUrl);
  const secure = url.protocol === 'https:' || url.protocol === 'wss:';
  url.protocol = scheme === 'ws' ? (secure ? 'wss:' : 'ws:') : (secure ? 'https:' : 'http:');
  return url.toString();
}

/** Available iff the temporary live server answers a plain GET /ws with 400. */
export async function isMeetingLiveAvailable(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl(liveUrl(baseUrl, 'http'), { signal: controller.signal });
    return response.status === 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type Socket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: 'close' | 'error', listener: () => void): void;
};

const defaultFactory: LiveUpstreamFactory = (url) => new WebSocket(url) as unknown as LiveUpstream;

export function registerProcedureMeetingLiveRoutes(
  app: FastifyInstance,
  options: { allowWriteKiosk: preHandlerHookHandler },
  deps: {
    upstreamFactory?: LiveUpstreamFactory;
    fetchImpl?: typeof fetch;
    sessionFactory?: LocalSessionFactory;
    sttHealthy?: () => Promise<boolean>;
    now?: () => number;
  } = {}
): void {
  const factory = deps.upstreamFactory ?? defaultFactory;
  const sessionFactory = deps.sessionFactory ?? defaultSessionFactory;
  const sttHealthy = deps.sttHealthy ?? defaultSttHealthy;
  const now = deps.now ?? Date.now;
  let localActive = false;

  const cache = new Map<'upstream' | 'stt', { at: number; value: boolean }>();
  const cached = async (key: 'upstream' | 'stt', probe: () => Promise<boolean>): Promise<boolean> => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < AVAILABILITY_TTL_MS) return hit.value;
    let value = false;
    try { value = await probe(); } catch { value = false; }
    cache.set(key, { at: now(), value });
    return value;
  };
  const upstreamUp = () => cached('upstream', () => isMeetingLiveAvailable(deps.fetchImpl));
  const sttUp = () => cached('stt', async () => Boolean(env.PROCEDURE_SPEECH_TO_TEXT_ENABLED) && (await sttHealthy()));

  app.get(`${MEETING_LIVE_PATH}/availability`, { preHandler: options.allowWriteKiosk }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { available: (await upstreamUp()) || (await sttUp()) };
  });

  app.get(MEETING_LIVE_PATH, { websocket: true }, (connection, req) => {
    const socket = ((connection as unknown as { socket?: unknown }).socket ?? connection) as Socket;
    let closed = false;
    let upstream: LiveUpstream | null = null;
    let upstreamOpen = false;
    let pending: Array<ArrayBuffer | Uint8Array | string> = [];
    let pendingBytes = 0;
    const v2 = (req.query as { v?: unknown }).v === '2';
    let session: LiveSession | null = null;
    let upstreamSeq = 0;
    const startedAt = now();

    const releaseSession = () => {
      if (!session) return;
      session.close();
      session = null;
      localActive = false;
    };
    const sendError = (error: 'busy' | 'unavailable') => {
      if (socket.readyState !== WS_OPEN) return;
      try { socket.send(JSON.stringify(v2 ? { type: 'error', error } : { error })); } catch { /* ignore */ }
    };
    const emitLocal = (message: LiveMessage) => {
      if (closed || socket.readyState !== WS_OPEN) return;
      try {
        if (v2) socket.send(JSON.stringify(message));
        else if (message.type === 'final') socket.send(JSON.stringify({ spk: 0, text: message.text, t: (now() - startedAt) / 1000 }));
        else if (message.type === 'error') socket.send(JSON.stringify({ error: message.error }));
      } catch { /* ignore */ }
    };

    const closeUpstream = () => {
      pending = [];
      try { upstream?.close(); } catch { /* already closed */ }
      releaseSession();
    };
    const closeDownstream = (code?: number, reason?: string) => {
      if (closed) return;
      closed = true;
      try { socket.close(code, reason); } catch { /* already closed */ }
    };
    const failUnavailable = () => {
      if (closed) return;
      sendError('unavailable');
      closeDownstream();
      closeUpstream();
    };
    const forward = (data: ArrayBuffer | Uint8Array | string) => {
      if (!upstream) return;
      if (upstreamOpen) {
        try { upstream.send(data); } catch { /* upstream gone */ }
        return;
      }
      const size = typeof data === 'string' ? data.length : data.byteLength;
      if (pendingBytes + size > BUFFER_LIMIT_BYTES) return;
      pendingBytes += size;
      pending.push(data);
    };

    // Handlers are attached synchronously so nothing sent during auth is lost.
    const early: Array<{ data: unknown; isBinary: boolean }> = [];
    let ready = false;
    const handle = (data: unknown, isBinary: boolean) => {
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data as Buffer[]) : (data as Buffer);
        if (session) session.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
        else forward(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        return;
      }
      const text = String(data);
      if (text === 'end') {
        const current = session;
        if (current) {
          void current.end().catch(() => sendError('unavailable')).finally(() => {
            releaseSession();
            closeDownstream();
          });
        } else {
          forward('end');
        }
      } else if (v2 && text.startsWith('{')) {
        try {
          const message = JSON.parse(text) as { type?: unknown; terms?: unknown };
          if (message.type === 'context' && typeof message.terms === 'string') {
            session?.setTerms(message.terms.slice(0, TERMS_MAX_CHARS));
          }
        } catch { /* ignore malformed context */ }
      }
    };
    let earlyBytes = 0;
    socket.on('message', (data, isBinary) => {
      if (!ready) {
        if (closed) return;
        earlyBytes += messageByteLength(data);
        if (earlyBytes > BUFFER_LIMIT_BYTES) {
          early.length = 0;
          closeDownstream(1009, 'Too much data before ready');
          return;
        }
        early.push({ data, isBinary });
        return;
      }
      handle(data, isBinary);
    });
    socket.on('close', () => { closed = true; closeUpstream(); });
    socket.on('error', () => { closed = true; closeUpstream(); });

    void (async () => {
      const clientKey = normalizeClientKey((req.query as { clientKey?: unknown }).clientKey);
      let authorized = false;
      if (clientKey) {
        try { authorized = Boolean(await findClientDeviceIdRecordByApiKey(clientKey)); } catch { authorized = false; }
      }
      if (!authorized) { closeDownstream(1008, 'Invalid client key'); return; }
      if (closed) return;

      const baseUrl = resolveBaseUrl();
      if (!baseUrl) { failUnavailable(); return; }
      if (!(await upstreamUp())) {
        if (!(await sttUp())) { failUnavailable(); return; }
        if (closed) return;
        if (localActive) { sendError('busy'); closeDownstream(); return; }
        localActive = true;
        session = sessionFactory({ emit: emitLocal, terms: '' });
        ready = true;
        for (const item of early.splice(0)) handle(item.data, item.isBinary);
        return;
      }
      if (closed) return;
      try {
        upstream = factory(liveUrl(baseUrl, 'ws'));
        upstream.binaryType = 'arraybuffer';
      } catch {
        failUnavailable();
        return;
      }
      upstream.addEventListener('open', () => {
        if (closed) { closeUpstream(); return; }
        upstreamOpen = true;
        const queued = pending;
        pending = [];
        pendingBytes = 0;
        for (const item of queued) {
          try { upstream?.send(item); } catch { /* ignore */ }
        }
      });
      upstream.addEventListener('message', (event) => {
        if (closed || typeof event.data !== 'string') return;
        if (!v2) {
          try { socket.send(event.data); } catch { /* ignore */ }
          return;
        }
        try {
          const line = JSON.parse(event.data) as { text?: unknown; error?: unknown };
          if (typeof line.error === 'string') {
            sendError(line.error === 'busy' ? 'busy' : 'unavailable');
          } else if (typeof line.text === 'string') {
            socket.send(JSON.stringify({ type: 'final', id: ++upstreamSeq, text: line.text }));
          }
        } catch { /* ignore */ }
      });
      upstream.addEventListener('error', () => {
        if (!upstreamOpen) failUnavailable();
      });
      upstream.addEventListener('close', () => {
        if (!upstreamOpen && !closed) { failUnavailable(); return; }
        if (v2 && !closed && socket.readyState === WS_OPEN) {
          try { socket.send(JSON.stringify({ type: 'done' })); } catch { /* ignore */ }
        }
        closeDownstream();
      });

      ready = true;
      for (const item of early.splice(0)) handle(item.data, item.isBinary);
    })();
  });
}
