import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import { env } from '../../config/env.js';
import { normalizeClientKey } from '../../lib/client-key.js';
import { findClientDeviceIdRecordByApiKey } from '../../services/clients/client-device-auth.service.js';
import { getInferenceRuntime } from '../../services/inference/inference-runtime.js';

export const MEETING_LIVE_PATH = '/assembly/procedure-documents/meeting-live';
const BUFFER_LIMIT_BYTES = 2 * 1024 * 1024;
const WS_OPEN = 1;

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
  deps: { upstreamFactory?: LiveUpstreamFactory; fetchImpl?: typeof fetch } = {}
): void {
  const factory = deps.upstreamFactory ?? defaultFactory;

  app.get(`${MEETING_LIVE_PATH}/availability`, { preHandler: options.allowWriteKiosk }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { available: await isMeetingLiveAvailable(deps.fetchImpl) };
  });

  app.get(MEETING_LIVE_PATH, { websocket: true }, (connection, req) => {
    const socket = ((connection as unknown as { socket?: unknown }).socket ?? connection) as Socket;
    let closed = false;
    let upstream: LiveUpstream | null = null;
    let upstreamOpen = false;
    let pending: Array<ArrayBuffer | Uint8Array | string> = [];
    let pendingBytes = 0;

    const closeUpstream = () => {
      pending = [];
      try { upstream?.close(); } catch { /* already closed */ }
    };
    const closeDownstream = (code?: number, reason?: string) => {
      if (closed) return;
      closed = true;
      try { socket.close(code, reason); } catch { /* already closed */ }
    };
    const failUnavailable = () => {
      if (closed) return;
      if (socket.readyState === WS_OPEN) {
        try { socket.send(JSON.stringify({ error: 'unavailable' })); } catch { /* ignore */ }
      }
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
        forward(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      } else if (String(data) === 'end') {
        forward('end');
      }
    };
    socket.on('message', (data, isBinary) => {
      if (!ready) { early.push({ data, isBinary }); return; }
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
        try { socket.send(event.data); } catch { /* ignore */ }
      });
      upstream.addEventListener('error', () => {
        if (!upstreamOpen) failUnavailable();
      });
      upstream.addEventListener('close', () => {
        if (!upstreamOpen && !closed) { failUnavailable(); return; }
        closeDownstream();
      });

      ready = true;
      for (const item of early.splice(0)) handle(item.data, item.isBinary);
    })();
  });
}
