import type { FastifyInstance } from 'fastify';

import { acknowledgeClientAlert, getClientAlertsDashboard } from '../../services/clients/client-alerts.service.js';
import { canManage, canViewStatus } from './shared.js';

export async function registerClientAlertRoutes(app: FastifyInstance): Promise<void> {
  // アラート情報を取得（ダッシュボード用）
  // Phase2完全移行: DBのみを参照。fileAlertsは互換性のため空配列/0を返す（deprecated）
  app.get('/clients/alerts', { preHandler: canViewStatus }, async (request) => {
    return getClientAlertsDashboard(request.id);
  });

  // アラートを確認済みにする（Phase2完全移行: DBのみ更新）
  app.post('/clients/alerts/:id/acknowledge', { preHandler: canManage }, async (request) => {
    const { id } = request.params as { id: string };
    return acknowledgeClientAlert(request.id, id);
  });
}
