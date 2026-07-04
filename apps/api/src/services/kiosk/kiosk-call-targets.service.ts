import { prisma } from '../../lib/prisma.js';
import { findClientDeviceByApiKey } from '../clients/client-device-auth.service.js';

export { findClientDeviceByApiKey };

export async function listClientStatusesForCallTargets() {
  return prisma.clientStatus.findMany({
    orderBy: { hostname: 'asc' }
  });
}

export async function listClientDevicesForCallTargets() {
  return prisma.clientDevice.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      location: true,
      statusClientId: true,
      lastSeenAt: true,
      updatedAt: true
    }
  });
}
