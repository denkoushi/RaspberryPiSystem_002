import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TORQUE_TRAINING_AGENT_HEARTBEAT_TIMEOUT_MS,
  TORQUE_TRAINING_AGENT_RECONNECT_MESSAGE,
  useTorqueTrainingAgentHeartbeat
} from './useTorqueTrainingAgentHeartbeat';

import type { TorqueAgentLeaseStatus } from './torqueAgentClient';

function agentStatus(overrides: Partial<TorqueAgentLeaseStatus> = {}): TorqueAgentLeaseStatus {
  return {
    ok: true,
    ready: true,
    state: 'owned_by_self',
    owner: null,
    bound: true,
    leaseOwned: true,
    bluetoothPowered: true,
    hidExclusive: true,
    lastError: null,
    ...overrides
  };
}

describe('useTorqueTrainingAgentHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends immediately and continues every two seconds beyond the eight-second binding TTL', async () => {
    const heartbeat = vi.fn().mockResolvedValue(agentStatus());
    const { result } = renderHook(() => useTorqueTrainingAgentHeartbeat({
      enabled: true,
      sessionId: 'session-1',
      confirmationId: 'confirmation-1',
      torqueWrenchProfileId: 'profile-1',
      heartbeat
    }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('healthy');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(heartbeat).toHaveBeenCalledTimes(6);
    expect(heartbeat).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      confirmationId: 'confirmation-1',
      torqueWrenchProfileId: 'profile-1'
    }, expect.any(AbortSignal));
  });

  it('does not start another heartbeat while the previous request is pending', async () => {
    let resolveFirst: ((status: TorqueAgentLeaseStatus) => void) | undefined;
    const firstRequest = new Promise<TorqueAgentLeaseStatus>((resolve) => {
      resolveFirst = resolve;
    });
    const heartbeat = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValue(agentStatus());
    const { result } = renderHook(() => useTorqueTrainingAgentHeartbeat({
      enabled: true,
      sessionId: 'session-1',
      confirmationId: 'confirmation-1',
      torqueWrenchProfileId: 'profile-1',
      heartbeat
    }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');

    await act(async () => {
      resolveFirst?.(agentStatus());
      await Promise.resolve();
    });
    expect(result.current.status).toBe('healthy');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it('reports lost when a hanging request reaches its timeout and aborts it', async () => {
    let capturedSignal: AbortSignal | undefined;
    const heartbeat = vi.fn((_payload, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<TorqueAgentLeaseStatus>(() => undefined);
    });
    const onLost = vi.fn();
    const { result, unmount } = renderHook(() => useTorqueTrainingAgentHeartbeat({
      enabled: true,
      sessionId: 'session-1',
      confirmationId: 'confirmation-1',
      torqueWrenchProfileId: 'profile-1',
      heartbeat,
      onLost
    }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TORQUE_TRAINING_AGENT_HEARTBEAT_TIMEOUT_MS - 1);
    });
    expect(result.current.status).toBe('idle');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current).toEqual({ status: 'lost', error: TORQUE_TRAINING_AGENT_RECONNECT_MESSAGE });
    expect(capturedSignal?.aborted).toBe(true);
    expect(onLost).toHaveBeenCalledWith(TORQUE_TRAINING_AGENT_RECONNECT_MESSAGE);
    unmount();
  });

  it.each([
    ['healthy', agentStatus(), 'healthy'],
    ['HID readiness pending', agentStatus({ ready: false }), 'connecting'],
    ['lease not owned', agentStatus({ leaseOwned: false }), 'lost'],
    ['agent response not ok', agentStatus({ ok: false }), 'lost'],
    ['unexpected lease state', agentStatus({ state: 'available' }), 'lost'],
    ['binding is absent', agentStatus({ bound: false }), 'lost']
  ] as const)('classifies %s as %s', async (_label, response, expected) => {
    const heartbeat = vi.fn().mockResolvedValue(response);
    const onLost = vi.fn();
    const { result } = renderHook(() => useTorqueTrainingAgentHeartbeat({
      enabled: true,
      sessionId: 'session-1',
      confirmationId: 'confirmation-1',
      torqueWrenchProfileId: 'profile-1',
      heartbeat,
      onLost
    }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe(expected);
    if (expected === 'lost') {
      expect(onLost).toHaveBeenCalledWith(TORQUE_TRAINING_AGENT_RECONNECT_MESSAGE);
    } else {
      expect(onLost).not.toHaveBeenCalled();
    }
  });
});
