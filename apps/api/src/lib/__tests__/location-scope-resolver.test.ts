import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCATION_SCOPE_KEY,
  resolveCredentialIdentity,
  resolveDeviceNameFromScopeKey,
  resolveDeviceName,
  resolveDeviceScopeKey,
  resolveLegacyLocationKey,
  resolveLocationScopeContext,
  resolveSiteKeyFromScopeKey,
  resolveSiteKey
} from '../location-scope-resolver.js';

describe('location-scope-resolver', () => {
  it('keeps legacy locationKey behavior', () => {
    expect(resolveLegacyLocationKey({ location: ' 第2工場 - kensakuMain ', name: 'raspberrypi4' })).toBe('第2工場 - kensakuMain');
    expect(resolveLegacyLocationKey({ location: null, name: 'raspberrypi4' })).toBe('raspberrypi4');
    expect(resolveLegacyLocationKey({ location: '', name: '' })).toBe(DEFAULT_LOCATION_SCOPE_KEY);
  });

  it('resolves site and device names from segmented location', () => {
    const input = { location: '第2工場 - RoboDrill01', name: 'raspi4-robodrill01' };
    expect(resolveDeviceScopeKey(input)).toBe('第2工場 - RoboDrill01');
    expect(resolveSiteKey(input)).toBe('第2工場');
    expect(resolveDeviceName(input)).toBe('RoboDrill01');
  });

  it('falls back to single-token names when separator is absent', () => {
    const input = { location: null, name: 'raspberrypi4' };
    expect(resolveDeviceScopeKey(input)).toBe('raspberrypi4');
    expect(resolveSiteKey(input)).toBe('raspberrypi4');
    expect(resolveDeviceName(input)).toBe('raspberrypi4');
  });

  it('resolves site/device directly from scope key strings', () => {
    expect(resolveSiteKeyFromScopeKey('第2工場 - RoboDrill01')).toBe('第2工場');
    expect(resolveDeviceNameFromScopeKey('第2工場 - RoboDrill01')).toBe('RoboDrill01');
    expect(resolveSiteKeyFromScopeKey('shared')).toBe('shared');
    expect(resolveDeviceNameFromScopeKey('shared')).toBe('shared');
    expect(resolveSiteKeyFromScopeKey('')).toBe(DEFAULT_LOCATION_SCOPE_KEY);
    expect(resolveDeviceNameFromScopeKey('')).toBe(DEFAULT_LOCATION_SCOPE_KEY);
  });

  it('resolves credential identity and standard scope context', () => {
    const context = resolveLocationScopeContext({
      id: 'client-uuid',
      apiKey: 'client-key-raspberrypi4-kiosk1',
      statusClientId: 'raspberrypi4-kiosk1',
      location: '第2工場 - kensakuMain',
      name: 'raspberrypi4'
    });

    expect(context.deviceScopeKey).toBe('第2工場 - kensakuMain');
    expect(context.siteKey).toBe('第2工場');
    expect(context.deviceName).toBe('kensakuMain');
    expect(context.infraHost).toBe('raspberrypi4');
    expect(context.credentialIdentity).toEqual({
      clientDeviceId: 'client-uuid',
      apiKey: 'client-key-raspberrypi4-kiosk1',
      statusClientId: 'raspberrypi4-kiosk1'
    });
    expect(
      resolveCredentialIdentity({
        id: 'client-uuid',
        apiKey: 'client-key',
        statusClientId: null
      })
    ).toEqual({
      clientDeviceId: 'client-uuid',
      apiKey: 'client-key',
      statusClientId: null
    });
  });

  it('prefers an explicit site over the location text guess', () => {
    const input = { location: null, name: 'Mac', siteKey: ' 第2工場 ' };
    expect(resolveSiteKey(input)).toBe('第2工場');
    expect(resolveDeviceScopeKey(input)).toBe('Mac');
    const context = resolveLocationScopeContext({ ...input, id: 'mac', apiKey: 'client-key-mac-kiosk1' });
    expect(context.siteKey).toBe('第2工場');
    expect(context.deviceScopeKey).toBe('Mac');
  });

  it('keeps the location text guess when no explicit site is set', () => {
    expect(resolveSiteKey({ location: '第2工場 - Sessaku-01', name: 'raspi4', siteKey: null })).toBe('第2工場');
    expect(resolveSiteKey({ location: null, name: 'Mac', siteKey: '  ' })).toBe('Mac');
  });

  it('exposes the proxy capability only when the device flag is true', () => {
    const base = { id: 'mac', apiKey: 'client-key-mac-kiosk1', location: null, name: 'Mac' };
    expect(resolveLocationScopeContext(base).canProxyOtherDevices).toBe(false);
    expect(resolveLocationScopeContext({ ...base, canProxyOtherDevices: true }).canProxyOtherDevices).toBe(true);
    expect(
      resolveLocationScopeContext({ ...base, name: 'raspi4', location: '第2工場 - A', canProxyOtherDevices: true })
        .canProxyOtherDevices
    ).toBe(true);
  });

  it('does not expose legacy location key in standard scope context', () => {
    const context = resolveLocationScopeContext({
      id: 'client-uuid',
      apiKey: 'client-key-raspberrypi4-kiosk1',
      statusClientId: 'raspberrypi4-kiosk1',
      location: '第2工場 - kensakuMain',
      name: 'raspberrypi4'
    });
    expect(context.deviceScopeKey).toBe('第2工場 - kensakuMain');
    expect(context.siteKey).toBe('第2工場');
    expect(context).not.toHaveProperty('legacyLocationKey');
  });
});
