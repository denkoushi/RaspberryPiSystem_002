import { promises as fs } from 'fs';
import path from 'path';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { authorizeRoles } from '../../lib/auth.js';
import { getFileStorageRoot } from '../../services/file-storage/file-storage-config.js';
import { SignageService } from '../../services/signage/index.js';
import { getSignageImageLastFetchedAt } from '../../services/signage/signage-delivery-tracker.js';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';

const csvPreviewParamsSchema = z.object({ id: z.string().uuid() });

function getRenderDir(): string {
  return process.env.SIGNAGE_RENDER_DIR || path.join(getFileStorageRoot(), 'signage-rendered');
}

/**
 * サーバーが最後に画像を描いた時刻（描画フォルダ内の端末用画像のうち、いちばん新しい更新時刻）。
 * 端末キーからファイル名を求める処理を通さず、フォルダの一覧だけで求める。未描画なら null。
 */
export async function readLastRenderedAt(renderDir: string = getRenderDir()): Promise<Date | null> {
  let names: string[];
  try {
    names = await fs.readdir(renderDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let latest: Date | null = null;
  for (const name of names) {
    if (!/^current(-[0-9a-f]{64})?\.jpg$/.test(name)) continue;
    try {
      const { mtime } = await fs.stat(path.join(renderDir, name));
      if (!latest || mtime > latest) latest = mtime;
    } catch {
      // 描画の入れ替え中に消えたファイルは無視する
    }
  }
  return latest;
}

/**
 * 管理画面（サイネージハブ・データボード）用の読み取り専用 API。
 */
export function registerManagementOverviewRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // サーバーが最後に描画した時刻と、端末ごとの「最後に取りに来た時刻」「いま順番に映している予定」
  app.get('/management/overview', { preHandler: canManage }, async () => {
    const clientKeys = await signageService.listSignageRenderClientApiKeys();
    const clients = await Promise.all(
      clientKeys.map(async (apiKey) => ({
        apiKey,
        lastFetchedAt: getSignageImageLastFetchedAt(apiKey)?.toISOString() ?? null,
        rotation: await signageService.getRotationForClient(apiKey),
      })),
    );
    return {
      generatedAt: new Date().toISOString(),
      renderIntervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS,
      scheduleSwitchIntervalSeconds: env.SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS,
      lastRenderedAt: (await readLastRenderedAt())?.toISOString() ?? null,
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
