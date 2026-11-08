import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { listClientDevices } from '../../services/clients/client-telemetry.service.js';
import { env } from '../../config/env.js';
import { authorizeRoles } from '../../lib/auth.js';
import { SignageService } from '../../services/signage/index.js';
import { getSignageImageLastFetchedAt } from '../../services/signage/signage-delivery-tracker.js';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';

const csvPreviewParamsSchema = z.object({ id: z.string().guid() });

/**
 * 管理画面（サイネージハブ・データボード）用の読み取り専用 API。
 */
export function registerManagementOverviewRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // 端末ごとの「最後に取りに来た時刻」と「いま順番に映している予定」。ファイルは読まない（メモリと DB だけ）
  app.get('/management/overview', { preHandler: canManage }, async () => {
    const devices = await listClientDevices({ omitApiKey: true });
    const clients = await Promise.all(
      devices.map(async ({ id: clientDeviceId }) => ({
        clientDeviceId,
        lastFetchedAt: getSignageImageLastFetchedAt(clientDeviceId)?.toISOString() ?? null,
        rotation: await signageService.getRotationForClient(clientDeviceId),
      })),
    );
    return {
      generatedAt: new Date().toISOString(),
      renderIntervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS,
      scheduleSwitchIntervalSeconds: env.SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS,
      clients,
    };
  });

  // CSV ダッシュボードを、サイネージに映るのと同じ描画で返す
  app.get('/preview/csv-dashboard/:id', { preHandler: canManage }, async (request, reply) => {
    const { id } = csvPreviewParamsSchema.parse(request.params);
    const buffer = await new SignageRenderer(signageService).renderCsvDashboardToBuffer(id);
    return reply.type('image/jpeg').header('Cache-Control', 'no-store').send(buffer);
  });
}
