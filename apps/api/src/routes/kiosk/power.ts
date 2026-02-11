import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';

const powerActionSchema = z.object({
  action: z.enum(['reboot', 'poweroff'])
});

type PowerRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: { id: string };
  }>;
  checkPowerRateLimit: (clientKey: string) => boolean;
  powerActionsDir: string;
};

export async function registerKioskPowerRoute(
  app: FastifyInstance,
  deps: PowerRouteDeps
): Promise<void> {
  app.post('/kiosk/power', { config: { rateLimit: false } }, async (request) => {
    const { clientKey, clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const allowed = deps.checkPowerRateLimit(clientKey);
    if (!allowed) {
      throw new ApiError(429, '操作が多すぎます。しばらく待ってから再度お試しください。', undefined, 'POWER_RATE_LIMIT');
    }

    const body = powerActionSchema.parse(request.body);
    const requestedAt = new Date().toISOString();
    const safeTimestamp = requestedAt.replace(/[:.]/g, '-');
    const filename = `${safeTimestamp}-${clientKey}.json`;

    // ディレクトリが存在しない場合は作成（ボリュームマウントされている場合は既に存在する）
    try {
      await fs.mkdir(deps.powerActionsDir, { recursive: true });
    } catch (error) {
      // ディレクトリが既に存在する場合はエラーを無視
      if (error instanceof Error && 'code' in error && error.code !== 'EEXIST') {
        throw error;
      }
    }

    const filePath = path.join(deps.powerActionsDir, filename);
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          action: body.action,
          clientKey,
          clientDeviceId: clientDevice.id,
          requestId: request.id,
          requestedAt
        },
        null,
        2
      ),
      'utf8'
    );

    return { requestId: request.id, action: body.action, status: 'accepted' };
  });
}
