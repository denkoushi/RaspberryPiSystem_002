import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveInventoryTag, type InventoryItem, type InventoryTag } from '../api/client';
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

describe('NFC inventory tag table', () => {
  it('dispatches known UIDs without resolve, uses live items stock and falls back for unknown or failed tables', async () => {
    setUserAgent('Mozilla/5.0 (X11; Linux armv7l) Chrome/120');
    vi.stubEnv('VITE_AGENT_WS_MODE', 'local');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tag = { id: 't', uid: 'known', kind: 'ITEM', quantity: null, compartment: { id: 'c', stockQuantity: 999, item: { name: 'stale', photos: [] } } } as InventoryTag;
    client.setQueryData(['inventory-tags'], [tag]);
    const item = { id: 'i', name: '最新の品名', photos: [{ id: 'photo' }], compartments: [{ id: 'c', stockQuantity: 7 }] } as InventoryItem;
    client.setQueryData(['inventory-items'], [item]);
    let socket: { close: ReturnType<typeof vi.fn>; onmessage?: (message: MessageEvent) => void } = { close: vi.fn() };
    vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () { socket = { close: vi.fn() }; return socket; }));
    vi.mocked(resolveInventoryTag).mockReset().mockResolvedValue({ ...tag, uid: 'unknown' });
    const hook = renderHook(() => ({ legacy: useNfcStream(true), inventory: useNfcStream(true, undefined, { role: 'inventory', inventoryQueryClient: client }) }));
    const scan = async (uid: string, eventId: number) => act(async () => { socket.onmessage?.({ data: JSON.stringify({ uid, eventId, timestamp: new Date(Date.now() + 1000).toISOString() }) } as MessageEvent); });
    try {
      await scan('known', 201);
      expect(resolveInventoryTag).not.toHaveBeenCalled();
      expect(hook.result.current.inventory?.inventoryTag?.compartment).toMatchObject({ id: 'c', stockQuantity: 7, item: { name: '最新の品名', photos: item.photos } });
      expect(hook.result.current.inventory?.inventoryTagFromCache).toBe(true);
      expect(hook.result.current.inventory?.inventoryTagNeedsRefresh).toBe(false);
      expect(hook.result.current.legacy).toBeNull();
      await scan('unknown', 202);
      await waitFor(() => expect(hook.result.current.inventory?.eventId).toBe(202));
      expect(hook.result.current.inventory?.inventoryTagFromCache).toBeUndefined();
      expect(resolveInventoryTag).toHaveBeenCalledExactlyOnceWith('unknown');
      client.getQueryCache().find({ queryKey: ['inventory-tags'] })!.setState({ status: 'error' });
      await scan('known', 203);
      await waitFor(() => expect(hook.result.current.inventory?.eventId).toBe(203));
      expect(resolveInventoryTag).toHaveBeenLastCalledWith('known');
      expect(resolveInventoryTag).toHaveBeenCalledTimes(2);
      client.removeQueries({ queryKey: ['inventory-tags'] });
      await scan('known', 204);
      await waitFor(() => expect(hook.result.current.inventory?.eventId).toBe(204));
      expect(resolveInventoryTag).toHaveBeenCalledTimes(3);
    } finally { hook.unmount(); client.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it('dispatches a known identity before a missing item cache can be fetched and keeps armed scans private', async () => {
    setUserAgent('Mozilla/5.0 (X11; Linux armv7l) Chrome/120');
    vi.stubEnv('VITE_AGENT_WS_MODE', 'local');
    const client = new QueryClient();
    client.setQueryData(['inventory-tags'], [{ id: 't', uid: 'cached-only', kind: 'ITEM', compartment: { id: 'c', stockQuantity: 999, item: { name: '品物', photos: [] } } }]);
    let socket: { close: ReturnType<typeof vi.fn>; onmessage?: (message: MessageEvent) => void } = { close: vi.fn() };
    vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () { socket = { close: vi.fn() }; return socket; }));
    vi.mocked(resolveInventoryTag).mockReset();
    const hook = renderHook(({ armed }) => ({
      legacy: useNfcStream(true, undefined, { suppressInventoryRouting: armed }),
      inventory: useNfcStream(true, undefined, { role: 'inventory', inventoryQueryClient: client }),
    }), { initialProps: { armed: false } });
    try {
      await act(async () => { socket.onmessage?.({ data: JSON.stringify({ uid: 'cached-only', eventId: 205, timestamp: new Date(Date.now() + 1000).toISOString() }) } as MessageEvent); });
      expect(resolveInventoryTag).not.toHaveBeenCalled();
      expect(hook.result.current.inventory?.inventoryTagNeedsRefresh).toBe(true);
      expect(hook.result.current.inventory?.inventoryTagFromCache).toBe(true);
      expect(hook.result.current.inventory?.inventoryTag?.compartment?.stockQuantity).toBeNaN();
      expect(hook.result.current.inventory?.inventoryTag?.compartment?.item.photos).toEqual([]);
      hook.rerender({ armed: true });
      await act(async () => { socket.onmessage?.({ data: JSON.stringify({ uid: 'cached-only', eventId: 206, timestamp: new Date(Date.now() + 1000).toISOString() }) } as MessageEvent); });
      expect(resolveInventoryTag).not.toHaveBeenCalled();
      await waitFor(() => expect(hook.result.current.legacy?.eventId).toBe(206));
      expect(hook.result.current.inventory?.eventId).toBe(205);
    } finally { hook.unmount(); client.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});


it('delivers cached ITEM then QUANTITY to subscriber effects in order after a blocked classification', async () => {
  setUserAgent('Mozilla/5.0 (X11; Linux armv7l) Chrome/120');
  vi.stubEnv('VITE_AGENT_WS_MODE', 'local');
  const client = new QueryClient();
  const item = { id: 'hub-order-item', uid: 'hub-order-item-uid', kind: 'ITEM', compartment: { id: 'hub-order-compartment', item: { name: '品物', photos: [] } } } as InventoryTag;
  const quantity = { id: 'hub-order-quantity', uid: 'hub-order-quantity-uid', kind: 'QUANTITY', quantity: 3, compartment: null } as InventoryTag;
  client.setQueryData(['inventory-tags'], [item, quantity]);
  let release: (tag: InventoryTag | null) => void = () => undefined;
  vi.mocked(resolveInventoryTag).mockReset().mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  let socket: { close: ReturnType<typeof vi.fn>; onmessage?: (message: MessageEvent) => void } = { close: vi.fn() };
  vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () { socket = { close: vi.fn() }; return socket; }));
  const received: string[] = [];
  const hook = renderHook(() => {
    const event = useNfcStream(true, undefined, { role: 'inventory', inventoryQueryClient: client });
    useEffect(() => { if (event) received.push(event.uid); }, [event]);
    return event;
  });
  try {
    act(() => {
      for (const [index, uid] of ['hub-order-blocked', item.uid, quantity.uid].entries()) {
        socket.onmessage?.({ data: JSON.stringify({ uid, eventId: 301 + index, timestamp: new Date(Date.now() + 1000).toISOString() }) } as MessageEvent);
      }
    });
    await waitFor(() => expect(resolveInventoryTag).toHaveBeenCalledExactlyOnceWith('hub-order-blocked'));
    expect(received).toEqual([]);
    act(() => { release(null); });
    await waitFor(() => expect(received).toEqual([item.uid, quantity.uid]));
    expect(resolveInventoryTag).toHaveBeenCalledOnce();
  } finally { hook.unmount(); client.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
