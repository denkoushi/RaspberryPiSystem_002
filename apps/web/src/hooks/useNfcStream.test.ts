import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveInventoryTag } from '../api/client';
import { getNfcWsCandidates } from '../features/nfc/nfcEventSource';
import { resolveNfcStreamPolicy } from '../features/nfc/nfcPolicy';

import { useNfcStream } from './useNfcStream';

vi.mock('../api/client', () => ({ resolveInventoryTag: vi.fn() }));

const setUserAgent = (ua: string) => {
  // jsdomでは userAgent が read-only のことがあるため defineProperty で上書き
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
};

describe('NFC stream isolation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
    // テスト内で明示する（未設定でも動くが、意図を固定する）
    (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_AGENT_WS_URL =
      'ws://localhost:7071/stream';
    (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_AGENT_WS_MODE = '';
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('localOnlyでは /stream (wss://<host>/stream) を候補に入れない', () => {
    const candidates = getNfcWsCandidates({
      policy: 'localOnly',
      envUrl: 'wss://example.test/stream',
      mode: 'local',
      location: { protocol: 'https:', host: 'example.test' },
    });
    expect(candidates).toEqual(['ws://localhost:7071/stream']);
  });

  it('legacyではHTTPSページで wss://<host>/stream を候補に入れる（互換）', () => {
    const candidates = getNfcWsCandidates({
      policy: 'legacy',
      envUrl: 'ws://127.0.0.1:7071/stream',
      mode: '',
      location: { protocol: 'https:', host: 'pi5.test' },
    });
    expect(candidates).toContain('wss://pi5.test/stream');
    expect(candidates).toContain('ws://127.0.0.1:7071/stream');
  });

  it('MacではNFCポリシーがdisabledになる', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Safari/537.36');
    (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_AGENT_WS_MODE = 'local';
    expect(resolveNfcStreamPolicy()).toBe('disabled');
  });

  it('MacではuseNfcStream(true)でもWebSocketを生成しない', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Safari/537.36');
    // 明示的にlocalを入れてもdisabledが優先されることを確認
    (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_AGENT_WS_MODE = 'local';

    const WebSocketMock = vi.fn().mockImplementation((_url: string) => {
      return { close: vi.fn() };
    });
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocketMock as unknown as typeof WebSocket;

    const hook = renderHook(() => useNfcStream(true));

    // effectを1回回す
    await new Promise((r) => setTimeout(r, 0));

    expect(WebSocketMock).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('shares one socket and dispatches inventory tags without leaking them to legacy handlers', async () => {
    setUserAgent('Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_AGENT_WS_MODE = 'local';
    const sockets: Array<{ close: ReturnType<typeof vi.fn>; onmessage?: (message: MessageEvent) => void }> = [];
    const WebSocketMock = vi.fn().mockImplementation(function (_url: string) {
      const socket = { close: vi.fn(), onmessage: undefined };
      sockets.push(socket);
      return socket;
    });
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocketMock as unknown as typeof WebSocket;
    vi.mocked(resolveInventoryTag).mockResolvedValue({ uid: 'item-uid', kind: 'ITEM' } as never);

    const combined = renderHook(() => ({
      legacy: useNfcStream(true),
      inventory: useNfcStream(true, undefined, { role: 'inventory' }),
    }));
    expect(WebSocketMock).toHaveBeenCalledTimes(1);

    const event = {
      uid: 'item-uid',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      eventId: 100,
    };
    const activeSocket = sockets[sockets.length - 1];
    await act(async () => {
      await new Promise<void>((resolve) => {
        activeSocket.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
        window.setTimeout(resolve, 0);
      });
    });

    expect(combined.result.current.inventory?.uid).toBe('item-uid');
    expect(combined.result.current.legacy).toBeNull();
    combined.unmount();
  });
});
