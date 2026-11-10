import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

// Existing installations may contain duplicate IDs, so serialize claims without
// requiring a destructive data cleanup before rollout.
export async function claimStatusClientId(deviceId: string, clientId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientId}, 0))`;
    const existing = await tx.clientDevice.findFirst({ where: { statusClientId: clientId, id: { not: deviceId } } });
    if (existing) throw new ApiError(409, '監視端末IDはすでに登録されています');
    const claimed = await tx.clientDevice.updateMany({ where: { id: deviceId, statusClientId: null }, data: { statusClientId: clientId } });
    if (claimed.count === 1) return clientId;
    const device = await tx.clientDevice.findUniqueOrThrow({ where: { id: deviceId } });
    if (device.statusClientId !== clientId) throw new ApiError(409, '監視端末IDはすでに登録されています');
    return clientId;
  });
}
