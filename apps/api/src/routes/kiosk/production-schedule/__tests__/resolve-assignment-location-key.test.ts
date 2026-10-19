import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../config/env.js', () => ({
  env: { KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED: true }
}));
vi.mock('../../../../lib/manual-order-device-scope.js', () => ({
  assertRegisteredDeviceScopeKey: vi.fn(async () => undefined)
}));
vi.mock('../../../../services/clients/client-device-auth.service.js', () => ({
  requireKioskClientDevice: vi.fn()
}));
vi.mock('../../../../services/security/kiosk-rate-limit.service.js', () => ({
  getKioskRateLimitService: vi.fn()
}));

import { assertRegisteredDeviceScopeKey } from '../../../../lib/manual-order-device-scope.js';
import { canProxyTargetLocation, shouldRequireTargetLocationForActor } from '../../shared.js';
import { resolveProductionScheduleAssignmentLocationKey } from '../resolve-assignment-location-key.js';

describe('proxy capability replaces the Mac scope-key string check', () => {
  beforeEach(() => vi.mocked(assertRegisteredDeviceScopeKey).mockClear());

  it('lets a proxy-capable device act for a registered target device site', async () => {
    await expect(
      resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: 'Mac',
        actorCanProxyOtherDevices: true,
        targetDeviceScopeKey: '第2工場 - Sessaku-01'
      })
    ).resolves.toBe('第2工場');
    expect(assertRegisteredDeviceScopeKey).toHaveBeenCalledWith('第2工場 - Sessaku-01');
  });

  it('requires a target for a proxy-capable device', async () => {
    await expect(
      resolveProductionScheduleAssignmentLocationKey({ actorDeviceScopeKey: 'Mac', actorCanProxyOtherDevices: true })
    ).rejects.toMatchObject({ code: 'TARGET_DEVICE_SCOPE_KEY_REQUIRED' });
  });

  it('does not grant proxy from the device scope key name alone', async () => {
    await expect(
      resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: 'Mac',
        actorCanProxyOtherDevices: false,
        targetDeviceScopeKey: '第2工場 - Sessaku-01'
      })
    ).rejects.toMatchObject({ code: 'TARGET_DEVICE_SCOPE_KEY_FORBIDDEN' });
    await expect(
      resolveProductionScheduleAssignmentLocationKey({ actorDeviceScopeKey: 'Mac', actorCanProxyOtherDevices: false })
    ).resolves.toBe('Mac');
  });

  it('keeps kiosks on their own site', async () => {
    await expect(
      resolveProductionScheduleAssignmentLocationKey({
        actorDeviceScopeKey: '第2工場 - kensakuMain',
        actorCanProxyOtherDevices: false
      })
    ).resolves.toBe('第2工場');
  });

  it('decides proxy helpers from the capability flag', () => {
    expect(canProxyTargetLocation({ canProxyOtherDevices: true })).toBe(true);
    expect(canProxyTargetLocation({ canProxyOtherDevices: false })).toBe(false);
    const previous = process.env.KIOSK_DUE_MANAGEMENT_REQUIRE_TARGET_LOCATION_FOR_MAC;
    process.env.KIOSK_DUE_MANAGEMENT_REQUIRE_TARGET_LOCATION_FOR_MAC = 'true';
    try {
      expect(shouldRequireTargetLocationForActor({ canProxyOtherDevices: true })).toBe(true);
      expect(shouldRequireTargetLocationForActor({ canProxyOtherDevices: false })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.KIOSK_DUE_MANAGEMENT_REQUIRE_TARGET_LOCATION_FOR_MAC;
      else process.env.KIOSK_DUE_MANAGEMENT_REQUIRE_TARGET_LOCATION_FOR_MAC = previous;
    }
  });
});
