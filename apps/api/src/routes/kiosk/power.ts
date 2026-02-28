import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { writeDebugLog } from '../../lib/debug-log.js';

const powerActionSchema = z.object({
  action: z.enum(['reboot', 'poweroff'])
});

type PowerRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{
    clientKey: string;
    clientDevice: { id: string };
  }>;
  checkPowerRateLimit: (clientKey: string, ip: string) => Promise<boolean>;
  powerActionsDir: string;
};

export async function registerKioskPowerRoute(
  app: FastifyInstance,
  deps: PowerRouteDeps
): Promise<void> {
  app.post('/kiosk/power', { config: { rateLimit: false } }, async (request) => {
    const rawHeader = request.headers['x-client-key'];
    const { clientKey, clientDevice } = await deps.requireClientDevice(rawHeader);
    // #region agent log
    await writeDebugLog({
      sessionId: 'power-debug',
      runId: 'run1',
      hypothesisId: 'H-power',
      location: 'kiosk/power.ts:post',
      message: 'POST /kiosk/power received',
      data: {
        rawHeader: typeof rawHeader === 'string' ? rawHeader : String(rawHeader),
        resolvedClientKey: clientKey,
        clientDeviceId: clientDevice.id,
        action: (request.body as { action?: string })?.action,
      },
      timestamp: Date.now(),
    });
    // #endregion
    const allowed = await deps.checkPowerRateLimit(clientKey, request.ip);
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
