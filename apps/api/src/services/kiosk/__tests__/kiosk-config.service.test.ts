import { KIOSK_INITIAL_ROUTE_PATHS } from '@raspi-system/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { findClientDeviceByApiKey } from '../../clients/client-device-auth.service.js';
import { resolveKioskConfigClientState } from '../kiosk-config.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { clientDevice: { update: vi.fn() }, clientStatus: { findUnique: vi.fn() } },
}));
vi.mock('../../clients/client-device-auth.service.js', () => ({ findClientDeviceByApiKey: vi.fn() }));

const now = new Date('2026-11-04T08:00:00Z');
const baseClient = {
  id: 'dev-1',
  defaultMode: null as string | null,
  kioskInitialRoute: null as string | null,
  kioskPortalHiddenTabIds: [] as string[],
  statusClientId: null as string | null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('resolveKioskConfigClientState', () => {
  it('falls back to TAG mode and the tag borrow path without a client key, touching nothing', async () => {
    await expect(resolveKioskConfigClientState(undefined)).resolves.toEqual({
      client: null,
      defaultMode: 'TAG',
      initialKioskRoute: null,
      initialKioskPath: KIOSK_INITIAL_ROUTE_PATHS.borrow_tag,
      portalHiddenTabIds: [],
      clientStatus: null,
    });
    expect(findClientDeviceByApiKey).not.toHaveBeenCalled();
  });

  it('treats an unknown key like an anonymous kiosk and does not update lastSeenAt', async () => {
    vi.mocked(findClientDeviceByApiKey).mockResolvedValue(null);
    const state = await resolveKioskConfigClientState('unknown');
    expect(state).toMatchObject({ client: null, defaultMode: 'TAG', initialKioskPath: KIOSK_INITIAL_ROUTE_PATHS.borrow_tag });
    expect(prisma.clientDevice.update).not.toHaveBeenCalled();
  });

  it('records the heartbeat time and uses the device PHOTO mode when no initial route is set', async () => {
    vi.mocked(findClientDeviceByApiKey).mockResolvedValue({ ...baseClient, defaultMode: 'PHOTO', kioskPortalHiddenTabIds: ['inventory'] } as never);
    const state = await resolveKioskConfigClientState('key');
    expect(prisma.clientDevice.update).toHaveBeenCalledWith({ where: { id: 'dev-1' }, data: { lastSeenAt: now } });
    expect(state).toMatchObject({
      defaultMode: 'PHOTO',
      initialKioskRoute: null,
      initialKioskPath: KIOSK_INITIAL_ROUTE_PATHS.borrow_photo,
      portalHiddenTabIds: ['inventory'],
    });
  });

  it('lets a valid initial route override the default mode path and ignores unknown routes', async () => {
    vi.mocked(findClientDeviceByApiKey).mockResolvedValue({ ...baseClient, defaultMode: 'PHOTO', kioskInitialRoute: ' self_inspection ' } as never);
    await expect(resolveKioskConfigClientState('key')).resolves.toMatchObject({
      initialKioskRoute: 'self_inspection',
      initialKioskPath: KIOSK_INITIAL_ROUTE_PATHS.self_inspection,
    });

    vi.mocked(findClientDeviceByApiKey).mockResolvedValue({ ...baseClient, defaultMode: 'PHOTO', kioskInitialRoute: 'removed_screen' } as never);
    await expect(resolveKioskConfigClientState('key')).resolves.toMatchObject({
      initialKioskRoute: null,
      initialKioskPath: KIOSK_INITIAL_ROUTE_PATHS.borrow_photo,
    });
  });

  it('attaches the linked telemetry status when present', async () => {
    const lastSeen = new Date('2026-11-04T07:59:00Z');
    vi.mocked(findClientDeviceByApiKey).mockResolvedValue({ ...baseClient, statusClientId: 'pi-1' } as never);
    vi.mocked(prisma.clientStatus.findUnique).mockResolvedValue({ clientId: 'pi-1', temperature: 52.5, cpuUsage: 12, lastSeen, hostname: 'pi' } as never);
    const state = await resolveKioskConfigClientState('key');
    expect(prisma.clientStatus.findUnique).toHaveBeenCalledWith({ where: { clientId: 'pi-1' } });
    expect(state.clientStatus).toEqual({ temperature: 52.5, cpuUsage: 12, lastSeen });
  });

  it('leaves clientStatus null when the linked status row is missing or no link exists', async () => {
    vi.mocked(findClientDeviceByApiKey).mockResolvedValue({ ...baseClient, statusClientId: 'pi-1' } as never);
    vi.mocked(prisma.clientStatus.findUnique).mockResolvedValue(null);
    await expect(resolveKioskConfigClientState('key')).resolves.toMatchObject({ clientStatus: null });

    vi.mocked(findClientDeviceByApiKey).mockResolvedValue({ ...baseClient } as never);
    vi.mocked(prisma.clientStatus.findUnique).mockClear();
    await expect(resolveKioskConfigClientState('key')).resolves.toMatchObject({ clientStatus: null });
    expect(prisma.clientStatus.findUnique).not.toHaveBeenCalled();
  });
});
