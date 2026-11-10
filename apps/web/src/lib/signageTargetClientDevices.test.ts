import { describe, expect, it } from 'vitest';

import {
  buildClientDevicesById,
  formatSignageTargetSummary,
  isSignageDisplayClientDevice,
  listSignageDisplayClientDevicesSorted,
  resolveSignageTargetClientCandidates,
} from './signageTargetClientDevices';

import type { ClientDevice } from '../api/client';

function mockDevice(partial: Partial<ClientDevice> & Pick<ClientDevice, 'id' | 'name'>): ClientDevice {
  return {
    apiKey: 'fixture-only-unused-credential',
    location: null,
    defaultMode: null,
    lastSeenAt: null,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('signageTargetClientDevices', () => {
  it('selects by the explicit flag regardless of credentials', () => {
    expect(isSignageDisplayClientDevice(mockDevice({ id: '1', name: 'Pi3', isSignage: true, apiKey: 'fixture-ordinary-key' }))).toBe(true);
    expect(isSignageDisplayClientDevice(mockDevice({ id: '2', name: 'Kiosk', isSignage: false, apiKey: 'fixture-signage-key' }))).toBe(false);
    expect(isSignageDisplayClientDevice(mockDevice({ id: '3', name: 'Unset' }))).toBe(false);
  });

  it('listSignageDisplayClientDevicesSorted returns only signage clients sorted by name', () => {
    const kiosk = mockDevice({ id: 'k', name: 'Kiosk', apiKey: 'client-key-kiosk' });
    const sigB = mockDevice({ id: 'b', name: 'B端末', isSignage: true });
    const sigA = mockDevice({ id: 'a', name: 'A端末', isSignage: true });
    expect(listSignageDisplayClientDevicesSorted([kiosk, sigB, sigA])).toEqual([sigA, sigB]);
  });

  it('resolveSignageTargetClientCandidates includes extras for selected non-signage keys', () => {
    const kiosk = mockDevice({ id: 'k', name: 'Kiosk', apiKey: 'client-key-kiosk' });
    const sig = mockDevice({ id: 's', name: 'Signage', isSignage: true });
    const all = [kiosk, sig];
    expect(resolveSignageTargetClientCandidates(all, [])).toEqual([sig]);
    const withExtra = resolveSignageTargetClientCandidates(all, ['k']);
    expect(withExtra).toHaveLength(2);
    expect(withExtra.map((c) => c.id).sort()).toEqual(['k', 's']);
  });

  it('formatSignageTargetSummary', () => {
    const empty = new Map<string, ClientDevice>();
    expect(formatSignageTargetSummary(undefined, empty)).toBe('全端末');
    expect(formatSignageTargetSummary([], empty)).toBe('全端末');
    const m = buildClientDevicesById([
      mockDevice({ id: 'a', name: '端末A', apiKey: 'key-a' }),
      mockDevice({ id: 'b', name: '端末B', apiKey: 'key-b' }),
    ]);
    expect(formatSignageTargetSummary(['a'], m)).toBe('端末A');
    expect(formatSignageTargetSummary(['a', 'b'], m)).toBe('端末A ほか 1台');
  });
});
