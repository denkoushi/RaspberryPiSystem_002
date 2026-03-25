import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

/**
 * クライアントIDを解決（clientIdまたはx-client-keyヘッダーから）
 */
export async function resolveClientDeviceId(
  clientId: string | undefined,
  apiKeyHeader: string | string[] | undefined
): Promise<string | undefined> {
  if (clientId) {
    const client = await prisma.clientDevice.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new ApiError(404, '指定されたクライアントが存在しません');
    }
    return client.id;
  }

  if (typeof apiKeyHeader === 'string') {
    const client = await prisma.clientDevice.findUnique({ where: { apiKey: apiKeyHeader } });
    if (!client) {
      throw new ApiError(401, 'クライアント API キーが不正です');
    }
    return client.id;
  }

  return undefined;
}
