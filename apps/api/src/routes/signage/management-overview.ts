import { promises as fs } from 'fs';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { authorizeRoles } from '../../lib/auth.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { SignageService } from '../../services/signage/index.js';
import { getSignageImageLastFetchedAt } from '../../services/signage/signage-delivery-tracker.js';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';

const csvPreviewParamsSchema = z.object({ id: z.string().uuid() });

/** 端末用の最新画像がいつ描画されたか（ファイルの更新時刻）。未描画なら null。 */
async function readRenderedAt(clientKey: string): Promise<Date | null> {
  try {
    return (await fs.stat(SignageRenderStorage.getCurrentImagePathForClient(clientKey))).mtime;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 管理画面（サイネージハブ・データボード）用の読み取り専用 API。
 */
export function registerManagementOverviewRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // 端末ごとの「サーバが描画した時刻」と「端末が最後に取りに来た時刻」
  app.get('/management/overview', { preHandler: canManage }, async () => {
    const clientKeys = await signageService.listSignageRenderClientApiKeys();
    const clients = await Promise.all(
      clientKeys.map(async (apiKey) => ({
        apiKey,
        renderedAt: (await readRenderedAt(apiKey))?.toISOString() ?? null,
        lastFetchedAt: getSignageImageLastFetchedAt(apiKey)?.toISOString() ?? null,
        rotation: await signageService.getRotationForClient(apiKey),
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
