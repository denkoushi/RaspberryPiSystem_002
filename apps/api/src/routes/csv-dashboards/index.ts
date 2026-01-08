import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { CsvDashboardService } from '../../services/csv-dashboard/index.js';
import { CsvDashboardIngestor } from '../../services/csv-dashboard/csv-dashboard-ingestor.js';
import { CsvDashboardStorage } from '../../lib/csv-dashboard-storage.js';
import {
  csvDashboardCreateSchema,
  csvDashboardUpdateSchema,
  csvDashboardParamsSchema,
} from './schemas.js';

export function registerCsvDashboardRoutes(app: FastifyInstance): void {
  const csvDashboardService = new CsvDashboardService();
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // 注意: multipartプラグインはapp.tsで既に登録済み

  // GET /api/csv-dashboards - CSVダッシュボード一覧取得
  app.get('/csv-dashboards', { preHandler: canManage }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const enabled = query.enabled !== undefined ? query.enabled === 'true' : undefined;
    const search = typeof query.search === 'string' ? query.search : undefined;

    const dashboards = await csvDashboardService.findAll({ enabled, search });
    return { dashboards };
  });

  // GET /api/csv-dashboards/:id - CSVダッシュボード詳細取得
  app.get('/csv-dashboards/:id', { preHandler: canManage }, async (request) => {
    const params = csvDashboardParamsSchema.parse(request.params);
    const dashboard = await csvDashboardService.findById(params.id);
    return { dashboard };
  });

  // POST /api/csv-dashboards - CSVダッシュボード作成
  app.post('/csv-dashboards', { preHandler: canManage }, async (request, reply) => {
    const body = csvDashboardCreateSchema.parse(request.body);
    const dashboard = await csvDashboardService.create(body);
    reply.code(201);
    return { dashboard };
  });

  // PUT /api/csv-dashboards/:id - CSVダッシュボード更新
  app.put('/csv-dashboards/:id', { preHandler: canManage }, async (request) => {
    const params = csvDashboardParamsSchema.parse(request.params);
    const body = csvDashboardUpdateSchema.parse(request.body);
    const dashboard = await csvDashboardService.update(params.id, body);
    return { dashboard };
  });

  // DELETE /api/csv-dashboards/:id - CSVダッシュボード削除
  app.delete('/csv-dashboards/:id', { preHandler: canManage }, async (request) => {
    const params = csvDashboardParamsSchema.parse(request.params);
    await csvDashboardService.delete(params.id);
    return { success: true };
  });

  // POST /api/csv-dashboards/:id/upload - CSVファイルアップロード（手動）
  app.post('/csv-dashboards/:id/upload', { preHandler: canManage }, async (request) => {
    const params = csvDashboardParamsSchema.parse(request.params);
    
    // ダッシュボードの存在確認
    await csvDashboardService.findById(params.id);

    const data = await request.file();
    if (!data) {
      throw new ApiError(400, 'CSVファイルがアップロードされていません');
    }

    const csvContent = await data.toBuffer();
    const csvText = csvContent.toString('utf-8');

    // CSVファイルを保存
    const csvFilePath = await CsvDashboardStorage.saveRawCsv(params.id, csvContent);

    // CSVデータを取り込む
    const ingestor = new CsvDashboardIngestor();
    const result = await ingestor.ingestFromGmail(
      params.id,
      csvText,
      undefined, // messageId (手動アップロードの場合は未指定)
      data.filename || 'manual-upload.csv',
      csvFilePath
    );

    return {
      success: true,
      rowsProcessed: result.rowsProcessed,
      rowsAdded: result.rowsAdded,
      rowsSkipped: result.rowsSkipped,
    };
  });

  // POST /api/csv-dashboards/:id/preview-parse - CSVプレビュー解析（CSVテキストを直接送信）
  app.post('/csv-dashboards/:id/preview-parse', { preHandler: canManage }, async (request) => {
    const params = csvDashboardParamsSchema.parse(request.params);
    
    // ダッシュボードの存在確認
    await csvDashboardService.findById(params.id);

    const body = z.object({ csvContent: z.string().min(1) }).parse(request.body);
    const preview = await csvDashboardService.previewCsv(body.csvContent);

    return { preview };
  });
}
