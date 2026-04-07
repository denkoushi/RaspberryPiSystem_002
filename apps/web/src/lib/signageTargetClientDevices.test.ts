import { describe, expect, it } from 'vitest';

import {
  buildClientDevicesByApiKey,
  formatSignageTargetSummary,
  isSignageDisplayClientDevice,
  resolveSignageTargetClientCandidates,
} from './signageTargetClientDevices';

import type { ClientDevice } from '../api/client';

function mockDevice(partial: Partial<ClientDevice> & Pick<ClientDevice, 'id' | 'name' | 'apiKey'>): ClientDevice {
  return {
    location: null,
    defaultMode: null,
    lastSeenAt: null,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('signageTargetClientDevices', () => {
  it('isSignageDisplayClientDevice matches apiKey containing signage', () => {
    expect(
      isSignageDisplayClientDevice(mockDevice({ id: '1', name: 'Pi3', apiKey: 'client-key-raspberrypi3-signage1' }))
    ).toBe(true);
    expect(isSignageDisplayClientDevice(mockDevice({ id: '2', name: 'Kiosk', apiKey: 'client-key-raspberrypi4-kiosk1' }))).toBe(
      false
    );
  });

  it('resolveSignageTargetClientCandidates includes extras for selected non-signage keys', () => {
    const kiosk = mockDevice({ id: 'k', name: 'Kiosk', apiKey: 'client-key-kiosk' });
    const sig = mockDevice({ id: 's', name: 'Signage', apiKey: 'client-key-signage-1' });
    const all = [kiosk, sig];
    expect(resolveSignageTargetClientCandidates(all, [])).toEqual([sig]);
    const withExtra = resolveSignageTargetClientCandidates(all, ['client-key-kiosk']);
    expect(withExtra).toHaveLength(2);
    expect(withExtra.map((c) => c.id).sort()).toEqual(['k', 's']);
  });

  it('formatSignageTargetSummary', () => {
    const empty = new Map<string, ClientDevice>();
    expect(formatSignageTargetSummary(undefined, empty)).toBe('全端末');
    expect(formatSignageTargetSummary([], empty)).toBe('全端末');
    const m = buildClientDevicesByApiKey([
      mockDevice({ id: 'a', name: '端末A', apiKey: 'key-a' }),
      mockDevice({ id: 'b', name: '端末B', apiKey: 'key-b' }),
    ]);
    expect(formatSignageTargetSummary(['key-a'], m)).toBe('端末A');
    expect(formatSignageTargetSummary(['key-a', 'key-b'], m)).toBe('端末A ほか 1台');
  });
});
