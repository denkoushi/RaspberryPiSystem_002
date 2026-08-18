import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createTorqueWrenchLocalLeaseToken,
  localhostTorqueWrenchTransport,
  sameTorqueWrenchLocalLeaseToken
} from './torqueWrenchConnectionTransport';

import type {
  TorqueAgentLeaseStatus,
  TorqueWrenchConnectionBinding
} from './torqueWrenchConnectionTransport';

const binding: TorqueWrenchConnectionBinding = {
  targetKind: 'training',
  sessionId: 'training-1',
  currentTemplateBoltId: null,
  confirmationId: 'confirmation-1',
  torqueWrenchProfileId: 'profile-1'
};

function status(overrides: Partial<TorqueAgentLeaseStatus> = {}): TorqueAgentLeaseStatus {
  return {
    ok: true,
    ready: false,
    state: 'owned_by_self',
    owner: null,
    bound: true,
    leaseOwned: true,
    bluetoothPowered: false,
    hidExclusive: false,
    lastError: null,
    ...overrides
  };
}

describe('torque wrench connection transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retains the full self-owned token, including target and context', () => {
    const token = createTorqueWrenchLocalLeaseToken(status({
      selfOwnedToken: {
        targetKind: 'training',
        sessionId: 'training-1',
        torqueWrenchProfileId: 'profile-1',
        leaseId: 'lease-1',
        generation: 7
      }
    }), binding);
    expect(token).toEqual({
      targetKind: 'training',
      sessionId: 'training-1',
      confirmationId: 'confirmation-1',
      profileId: 'profile-1',
      leaseId: 'lease-1',
      generation: 7
    });
    expect(sameTorqueWrenchLocalLeaseToken(token, { ...token!, generation: 7 })).toBe(true);
    expect(sameTorqueWrenchLocalLeaseToken(token, { ...token!, generation: 8 })).toBe(false);
  });

  it('sends a training takeover and unwraps release status envelopes', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, _init?: RequestInit) => {
      if (url.endsWith('/lease/release')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ result: 'released', status: status({ state: 'available', leaseOwned: false, bound: false }) })
        });
      }
      return Promise.resolve({ ok: true, json: async () => status({ state: 'handoff_wait' }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const token = createTorqueWrenchLocalLeaseToken(status({
      selfOwnedToken: {
        targetKind: 'training',
        sessionId: 'training-1',
        torqueWrenchProfileId: 'profile-1',
        leaseId: 'lease-1',
        generation: 7
      }
    }), binding)!;

    await localhostTorqueWrenchTransport.takeover({
      ...binding,
      requestId: 'takeover-1',
      physicalWrenchPresent: true,
      reason: 'operator-confirmed'
    });
    const released = await localhostTorqueWrenchTransport.release({ reason: 'PAGE_LEFT', token, keepalive: true });

    expect(fetchMock.mock.calls[0][0]).toContain('/lease/takeover');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      targetKind: 'training',
      currentTemplateBoltId: null,
      physicalWrenchPresent: true
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      leaseId: 'lease-1',
      generation: 7,
      sessionId: 'training-1',
      torqueWrenchProfileId: 'profile-1'
    });
    expect(released.state).toBe('available');
  });
});
