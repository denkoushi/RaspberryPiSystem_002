import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export async function getClientCapabilities(clientDeviceId: string): Promise<{
  shelfLayoutEditEnabled: boolean;
  haizenEdgeEnabled: boolean;
}> {
  const device = await prisma.clientDevice.findUniqueOrThrow({
    where: { id: clientDeviceId },
    select: { shelfLayoutEditEnabled: true, haizenEdgeEnabled: true }
  });
  return {
    shelfLayoutEditEnabled: device.shelfLayoutEditEnabled,
    haizenEdgeEnabled: device.haizenEdgeEnabled
  };
}

export async function requireShelfLayoutEditEnabled(clientDeviceId: string): Promise<void> {
  const caps = await getClientCapabilities(clientDeviceId);
  if (!caps.shelfLayoutEditEnabled) {
    throw new ApiError(403, '棚レイアウト編集権限がありません', undefined, 'SHELF_LAYOUT_EDIT_FORBIDDEN');
  }
}
