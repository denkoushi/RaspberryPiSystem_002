import type { ClientDevice } from '@prisma/client';
import {
  normalizeKioskInitialRoute,
  resolveKioskInitialPath,
  type KioskInitialRouteId
} from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import { findClientDeviceByApiKey } from '../clients/client-device-auth.service.js';

export type KioskConfigClientStatus = {
  temperature: number | null;
  cpuUsage: number;
  lastSeen: Date;
};

export type KioskConfigClientState = {
  client: ClientDevice | null;
  defaultMode: 'PHOTO' | 'TAG';
  initialKioskRoute: KioskInitialRouteId | null;
  initialKioskPath: string;
  clientStatus: KioskConfigClientStatus | null;
};

export async function resolveKioskConfigClientState(
  clientKey: string | undefined
): Promise<KioskConfigClientState> {
  let defaultMode: 'PHOTO' | 'TAG' = 'TAG';
  let clientStatus: KioskConfigClientStatus | null = null;

  if (!clientKey) {
    return {
      client: null,
      defaultMode,
      initialKioskRoute: null,
      initialKioskPath: resolveKioskInitialPath({ defaultMode }),
      clientStatus
    };
  }

  const client = await findClientDeviceByApiKey(clientKey);

  if (client) {
    await prisma.clientDevice.update({
      where: { id: client.id },
      data: { lastSeenAt: new Date() }
    });
  }

  if (client?.defaultMode) {
    defaultMode = client.defaultMode as 'PHOTO' | 'TAG';
  }
  const initialKioskRoute = normalizeKioskInitialRoute(client?.kioskInitialRoute);
  const initialKioskPath = resolveKioskInitialPath({
    initialRoute: initialKioskRoute,
    defaultMode
  });

  const statusClientId = (client as { statusClientId?: string | null } | null)?.statusClientId;
  if (statusClientId) {
    const status = await prisma.clientStatus.findUnique({
      where: { clientId: statusClientId }
    });
    if (status) {
      clientStatus = {
        temperature: status.temperature,
        cpuUsage: status.cpuUsage,
        lastSeen: status.lastSeen
      };
    }
  }

  return { client, defaultMode, initialKioskRoute, initialKioskPath, clientStatus };
}
