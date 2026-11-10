import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { requireKioskClientDevice } from './client-device-auth.service.js';

/**
 * キーを検証してクライアントIDを解決。キー不要の経路は呼び出し元でJWT認証する。
 */
export async function resolveClientDeviceId(
  clientId: string | undefined,
  apiKeyHeader: string | string[] | undefined,
  requireClientKey = false
): Promise<string | undefined> {
  if (apiKeyHeader || requireClientKey) {
    const { clientDevice } = await requireKioskClientDevice(apiKeyHeader);
    if (!clientId || clientId === clientDevice.id) {
      return clientDevice.id;
    }
    if (!clientDevice.canProxyOtherDevices) {
      throw new ApiError(403, '他のクライアントを指定する権限がありません');
    }
  }

  if (clientId) {
    const client = await prisma.clientDevice.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new ApiError(404, '指定されたクライアントが存在しません');
    }
    return client.id;
  }

  return undefined;
}

export type ClientDeviceOperationActor = { id: string; canProxyOtherDevices: boolean };

export function assertClientDeviceOperationScope(
  caller: ClientDeviceOperationActor | null,
  ownerClientDeviceId: string | null | undefined
): void {
  if (!caller || ownerClientDeviceId == null || ownerClientDeviceId === caller.id || caller.canProxyOtherDevices) return;
  throw new ApiError(403, '作業端末が一致しません', undefined, 'CLIENT_DEVICE_SCOPE_MISMATCH');
}
