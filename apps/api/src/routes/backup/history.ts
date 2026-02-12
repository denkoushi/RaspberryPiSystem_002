import { BackupOperationType, BackupStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { BackupHistoryService } from '../../services/backup/backup-history.service.js';

export async function registerBackupHistoryRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // バックアップ履歴一覧取得
  app.get('/backup/history', {
    preHandler: [mustBeAdmin],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          operationType: { type: 'string', enum: ['BACKUP', 'RESTORE'] },
          targetKind: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as {
      operationType?: 'BACKUP' | 'RESTORE';
      targetKind?: string;
      status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
      startDate?: string;
      endDate?: string;
      offset?: number;
      limit?: number;
    };

    const historyService = new BackupHistoryService();
    const result = await historyService.getHistoryWithFilter({
      operationType: query.operationType ? BackupOperationType[query.operationType] : undefined,
      targetKind: query.targetKind,
      status: query.status ? BackupStatus[query.status] : undefined,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      offset: query.offset,
      limit: query.limit,
    });

    return reply.status(200).send({
      history: result.history,
      total: result.total,
      offset: query.offset ?? 0,
      limit: query.limit ?? 100,
    });
  });

  // バックアップ履歴詳細取得
  app.get('/backup/history/:id', {
    preHandler: [mustBeAdmin],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const historyService = new BackupHistoryService();

    try {
      const history = await historyService.getHistoryById(id);
      return reply.status(200).send(history);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new ApiError(404, `Backup history not found: ${id}`);
      }
      throw error;
    }
  });
}
