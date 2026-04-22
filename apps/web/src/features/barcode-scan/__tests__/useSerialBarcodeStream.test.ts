import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSerialBarcodeStream } from '../useSerialBarcodeStream';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
}

describe('useSerialBarcodeStream', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('barcodeScan ペイロードで onScan を呼ぶ', async () => {
    const onScan = vi.fn();

    renderHook(() => useSerialBarcodeStream(true, onScan, 'ws://test.local/stream'));

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    expect(MockWebSocket.instances[0]?.url).toBe('ws://test.local/stream');

    const payload = {
      type: 'barcodeScan',
      text: ' ABC ',
      eventId: 1,
      timestamp: new Date().toISOString(),
    };
    MockWebSocket.instances[0]?.onmessage?.call({} as WebSocket, { data: JSON.stringify(payload) } as MessageEvent);

    expect(onScan).toHaveBeenCalledWith('ABC');
  });

  it('enabled が false のとき WebSocket を開かない', async () => {
    renderHook(() => useSerialBarcodeStream(false, vi.fn(), 'ws://test.local/stream'));

    await new Promise((r) => setTimeout(r, 30));
    expect(MockWebSocket.instances.length).toBe(0);
  });

  it('重複 eventId は無視する', async () => {
    window.sessionStorage.setItem('kiosk-last-barcode-event-id', '5');
    const onScan = vi.fn();

    renderHook(() => useSerialBarcodeStream(true, onScan, 'ws://test.local/stream'));

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    const ts = new Date().toISOString();
    const ws = MockWebSocket.instances[0];
    ws?.onmessage?.call({} as WebSocket, {
      data: JSON.stringify({ type: 'barcodeScan', text: 'OLD', eventId: 3, timestamp: ts }),
    } as MessageEvent);
    ws?.onmessage?.call({} as WebSocket, {
      data: JSON.stringify({ type: 'barcodeScan', text: 'NEW', eventId: 6, timestamp: ts }),
    } as MessageEvent);

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('NEW');
  });
});
