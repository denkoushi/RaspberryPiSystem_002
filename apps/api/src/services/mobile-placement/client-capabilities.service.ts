import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export async function getClientCapabilities(clientDeviceId: string): Promise<{
  shelfLayoutEditEnabled: boolean;
  haizenEdgeEnabled: boolean;
  procedureBoardEnabled: boolean;
}> {
  const device = await prisma.clientDevice.findUniqueOrThrow({
    where: { id: clientDeviceId },
    select: { shelfLayoutEditEnabled: true, haizenEdgeEnabled: true, procedureBoardEnabled: true }
  });
  return {
    shelfLayoutEditEnabled: device.shelfLayoutEditEnabled,
    haizenEdgeEnabled: device.haizenEdgeEnabled,
    procedureBoardEnabled: device.procedureBoardEnabled === true
  };
}

export async function requireShelfLayoutEditEnabled(clientDeviceId: string): Promise<void> {
  const caps = await getClientCapabilities(clientDeviceId);
  if (!caps.shelfLayoutEditEnabled) {
    throw new ApiError(403, '棚レイアウト編集権限がありません', undefined, 'SHELF_LAYOUT_EDIT_FORBIDDEN');
  }
}

export async function requireProcedureBoardEnabled(clientDeviceId: string): Promise<void> {
  if (!(await getClientCapabilities(clientDeviceId)).procedureBoardEnabled) {
    throw new ApiError(403, '手順づくり権限がありません', undefined, 'PROCEDURE_BOARD_FORBIDDEN');
  }
}
