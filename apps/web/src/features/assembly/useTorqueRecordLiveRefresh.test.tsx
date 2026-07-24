import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTorqueRecordLiveRefresh } from './useTorqueRecordLiveRefresh';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    return undefined;
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

const committed = (sourceEventKey: string, sessionId = 'session-1') => ({
  type: 'torqueRecordCommitted',
  sessionId,
  sourceEventKey,
  capturedAt: '2026-07-24T00:00:00.000Z',
  acknowledgedAt: '2026-07-24T00:00:00.050Z'
});

describe('useTorqueRecordLiveRefresh', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('immediately reloads the authoritative session for a matching committed event', async () => {
    const loadSession = vi.fn().mockResolvedValue({ revision: 2 });
    const onSessionLoaded = vi.fn();

    renderHook(() => useTorqueRecordLiveRefresh({
      enabled: true,
      sessionId: 'session-1',
      knownSourceEventKeys: new Set(),
      loadSession,
      onSessionLoaded
    }));

    act(() => MockWebSocket.instances[0].emit(committed('event-1')));

    await waitFor(() => expect(loadSession).toHaveBeenCalledWith('session-1'));
    expect(onSessionLoaded).toHaveBeenCalledWith({ revision: 2 });
  });

  it('ignores malformed, other-session, known, and duplicate notifications', async () => {
    const loadSession = vi.fn().mockResolvedValue({ revision: 2 });

    renderHook(() => useTorqueRecordLiveRefresh({
      enabled: true,
      sessionId: 'session-1',
      knownSourceEventKeys: new Set(['known-event']),
      loadSession,
      onSessionLoaded: vi.fn()
    }));

    act(() => {
      const socket = MockWebSocket.instances[0];
      socket.emit({ type: 'unexpected' });
      socket.emit(committed('event-2', 'session-2'));
      socket.emit(committed('known-event'));
      socket.emit(committed('event-1'));
      socket.emit(committed('event-1'));
    });

    await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(1));
  });

  it('serializes overlapping notification refreshes and coalesces the pending read', async () => {
    let resolveFirst: ((value: { revision: number }) => void) | undefined;
    const first = new Promise<{ revision: number }>((resolve) => {
      resolveFirst = resolve;
    });
    const loadSession = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ revision: 3 });
    const onSessionLoaded = vi.fn();

    renderHook(() => useTorqueRecordLiveRefresh({
      enabled: true,
      sessionId: 'session-1',
      knownSourceEventKeys: new Set(),
      loadSession,
      onSessionLoaded
    }));

    act(() => {
      MockWebSocket.instances[0].emit(committed('event-1'));
      MockWebSocket.instances[0].emit(committed('event-2'));
    });

    expect(loadSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst?.({ revision: 2 });
      await first;
    });

    await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(2));
    expect(onSessionLoaded.mock.calls).toEqual([
      [{ revision: 2 }],
      [{ revision: 3 }]
    ]);
  });

  it('keeps the 1.2 second poll as a fallback when no notification arrives', async () => {
    const loadSession = vi.fn().mockResolvedValue({ revision: 2 });

    renderHook(() => useTorqueRecordLiveRefresh({
      enabled: true,
      sessionId: 'session-1',
      knownSourceEventKeys: new Set(),
      loadSession,
      onSessionLoaded: vi.fn(),
      pollIntervalMs: 10
    }));

    await waitFor(() => expect(loadSession).toHaveBeenCalled());
  });

  it('coalesces thirty synthetic events into a complete authoritative refresh within budget', async () => {
    const committedKeys = new Set<string>();
    const loadSession = vi.fn(async () => ({ eventKeys: [...committedKeys] }));
    const onSessionLoaded = vi.fn();

    renderHook(() => useTorqueRecordLiveRefresh({
      enabled: true,
      sessionId: 'session-1',
      knownSourceEventKeys: new Set(),
      loadSession,
      onSessionLoaded
    }));

    const startedAt = performance.now();
    act(() => {
      for (let index = 0; index < 30; index += 1) {
        const eventKey = `event-${index.toString().padStart(2, '0')}`;
        committedKeys.add(eventKey);
        MockWebSocket.instances[0].emit(committed(eventKey));
      }
    });

    await waitFor(() => {
      const latest = onSessionLoaded.mock.calls.at(-1)?.[0] as { eventKeys: string[] } | undefined;
      expect(latest?.eventKeys).toHaveLength(30);
      expect(new Set(latest?.eventKeys).size).toBe(30);
    });
    const renderedAt = performance.now();

    expect(renderedAt - startedAt).toBeLessThanOrEqual(800);
    expect(loadSession.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
