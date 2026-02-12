import type { FastifyInstance } from 'fastify';
import pkg from '@prisma/client';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';

const { ImportStatus } = pkg;
type ImportStatusValue = (typeof ImportStatus)[keyof typeof ImportStatus];
const importStatusValues = Object.values(ImportStatus) as ImportStatusValue[];

function isImportStatus(value: string): value is ImportStatusValue {
  return importStatusValues.includes(value as ImportStatusValue);
}

export async function registerImportHistoryRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // 履歴一覧取得（フィルタ/ページング対応）
  app.get('/imports/history', { preHandler: mustBeAdmin }, async (request) => {
    const { ImportHistoryService } = await import('../../services/imports/import-history.service.js');
    const historyService = new ImportHistoryService();

    const query = request.query as {
      status?: string;
      scheduleId?: string;
      startDate?: string;
      endDate?: string;
      offset?: string;
      limit?: string;
    };

    const status = (query.status && isImportStatus(query.status))
      ? query.status
      : undefined;
    const scheduleId = query.scheduleId;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;

    const result = await historyService.getHistoryWithFilter({
      status,
      scheduleId,
      startDate,
      endDate,
      offset,
      limit,
    });

    return result;
  });

  // スケジュールIDで履歴取得（フィルタ/ページング対応）
  app.get('/imports/schedule/:id/history', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };

    const { ImportHistoryService } = await import('../../services/imports/import-history.service.js');
    const historyService = new ImportHistoryService();

    const query = request.query as {
      status?: string;
      startDate?: string;
      endDate?: string;
      offset?: string;
      limit?: string;
    };

    const status = (query.status && isImportStatus(query.status))
      ? query.status
      : undefined;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;

    const result = await historyService.getHistoryWithFilter({
      scheduleId: id,
      status,
      startDate,
      endDate,
      offset,
      limit,
    });

    return result;
  });

  // 失敗した履歴取得（フィルタ/ページング対応）
  app.get('/imports/history/failed', { preHandler: mustBeAdmin }, async (request) => {
    const { ImportHistoryService } = await import('../../services/imports/import-history.service.js');
    const historyService = new ImportHistoryService();

    const query = request.query as {
      scheduleId?: string;
      startDate?: string;
      endDate?: string;
      offset?: string;
      limit?: string;
    };

    const scheduleId = query.scheduleId;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;

    const result = await historyService.getHistoryWithFilter({
      status: ImportStatus.FAILED,
      scheduleId,
      startDate,
      endDate,
      offset,
      limit,
    });

    return result;
  });

  // 履歴詳細取得
  app.get('/imports/history/:historyId', { preHandler: mustBeAdmin }, async (request) => {
    const { historyId } = request.params as { historyId: string };

    const { ImportHistoryService } = await import('../../services/imports/import-history.service.js');
    const historyService = new ImportHistoryService();

    const history = await historyService.getHistory(historyId);

    if (!history) {
      throw new ApiError(404, `履歴が見つかりません: ${historyId}`);
    }

    return { history };
  });
}
