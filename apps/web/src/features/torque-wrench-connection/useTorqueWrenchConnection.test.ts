import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTorqueWrenchConnection } from './useTorqueWrenchConnection';

import type {
  TorqueAgentLeaseStatus,
  TorqueWrenchConnectionTransport
} from './torqueWrenchConnectionTransport';

function status(overrides: Partial<TorqueAgentLeaseStatus> = {}): TorqueAgentLeaseStatus {
  return {
    ok: true,
    ready: false,
    state: 'available',
    owner: null,
    bound: false,
    leaseOwned: false,
    bluetoothPowered: false,
    hidExclusive: false,
    lastError: null,
    ...overrides
  };
}

function selfStatus(generation: number, ready = false): TorqueAgentLeaseStatus {
  return status({
    state: 'owned_by_self',
    ready,
    leaseOwned: true,
    bound: true,
    bluetoothPowered: ready,
    hidExclusive: ready,
    selfOwnedToken: {
      targetKind: 'assembly',
      sessionId: 'session-1',
      torqueWrenchProfileId: 'profile-1',
      leaseId: 'lease-1',
      generation
    }
  });
}

function transport(overrides: Partial<TorqueWrenchConnectionTransport> = {}): TorqueWrenchConnectionTransport {
  return {
    health: vi.fn().mockResolvedValue(status()),
    heartbeat: vi.fn().mockResolvedValue(status()),
    acquire: vi.fn().mockResolvedValue(selfStatus(1)),
    takeover: vi.fn().mockResolvedValue(selfStatus(2)),
    release: vi.fn().mockResolvedValue(status()),
    ...overrides
  };
}

describe('useTorqueWrenchConnection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses one shared two-second heartbeat and holds the full token for exact release', async () => {
    vi.useFakeTimers();
    const fakeTransport = transport({
      heartbeat: vi.fn().mockResolvedValue(selfStatus(1, true))
    });
    const { result, unmount } = renderHook(() => useTorqueWrenchConnection({
      enabled: true,
      targetKind: 'assembly',
      sessionId: 'session-1',
      currentTemplateBoltId: 'bolt-1',
      confirmationId: 'confirmation-1',
      torqueWrenchProfileId: 'profile-1',
      transport: fakeTransport
    }));

    await act(async () => {
      await result.current.acquire('acquire-1');
    });
    expect(result.current.token).toMatchObject({ leaseId: 'lease-1', generation: 1 });
    expect(result.current.ready).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fakeTransport.heartbeat).toHaveBeenCalled();
    expect(result.current.ready).toBe(true);

    await act(async () => {
      await result.current.release('OPERATOR_RELEASE');
    });
    expect(fakeTransport.release).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'OPERATOR_RELEASE',
      token: expect.objectContaining({ leaseId: 'lease-1', generation: 1 })
    }));
    unmount();
  });

  it('does not release a stale generation after a status token mismatch', async () => {
    vi.useFakeTimers();
    const fakeTransport = transport({
      heartbeat: vi.fn()
        .mockResolvedValueOnce(status())
        .mockResolvedValueOnce(status({
          state: 'owned_by_self',
          leaseOwned: true,
          selfOwnedToken: {
            targetKind: 'assembly',
            sessionId: 'session-1',
            torqueWrenchProfileId: 'profile-1',
            leaseId: 'lease-other',
            generation: 9
          }
        }))
    });
    const { result, unmount } = renderHook(() => useTorqueWrenchConnection({
      enabled: true,
      targetKind: 'assembly',
      sessionId: 'session-1',
      currentTemplateBoltId: 'bolt-1',
      confirmationId: 'confirmation-1',
      torqueWrenchProfileId: 'profile-1',
      transport: fakeTransport
    }));
    await act(async () => {
      await result.current.acquire('acquire-1');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.token).toBeNull();
    expect(result.current.requiresExplicitAcquire).toBe(true);
    expect(result.current.state).toBe('available');
    expect(fakeTransport.release).not.toHaveBeenCalled();
    unmount();
  });
});
