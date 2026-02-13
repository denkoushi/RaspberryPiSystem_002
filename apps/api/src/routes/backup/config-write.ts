import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { BackupConfigHistoryService, redactBackupConfig } from '../../services/backup/backup-config-history.service.js';
import { getBackupTargetTemplates } from '../../services/backup/backup-target-templates.js';
import {
  addBackupTargetBodySchema,
  addBackupTargetFromTemplateBodySchema,
  backupConfigBodySchema,
  backupConfigHistoryIdParamsSchema,
  backupConfigHistoryQuerySchema,
  updateBackupTargetBodySchema,
  updateBackupTargetParamsSchema,
} from './schemas.js';

export async function registerBackupConfigWriteRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  // 設定変更履歴の取得
  app.get('/backup/config/history', {
    preHandler: [mustBeAdmin],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const query = backupConfigHistoryQuerySchema.parse(request.query);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    const [items, total] = await Promise.all([
      prisma.backupConfigChange.findMany({
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.backupConfigChange.count(),
    ]);
    return reply.status(200).send({ history: items, total, offset, limit });
  });

  app.get('/backup/config/history/:id', {
    preHandler: [mustBeAdmin],
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = backupConfigHistoryIdParamsSchema.parse(request.params);
    const entry = await prisma.backupConfigChange.findUnique({ where: { id } });
    if (!entry) {
      throw new ApiError(404, `Backup config history not found: ${id}`);
    }
    return reply.status(200).send(entry);
  });

  // 設定の更新
  app.put('/backup/config', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
      },
    },
  }, async (request, reply) => {
    const beforeConfig = await BackupConfigLoader.load();
    const config = backupConfigBodySchema.parse(request.body) as BackupConfig;
    await BackupConfigLoader.save(config);
    // スケジューラーを再読み込み（設定変更を即時反映）
    const { getBackupScheduler } = await import('../../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();

    const historyService = new BackupConfigHistoryService();
    await historyService.recordChange({
      actionType: 'config_update',
      actorUserId: request.user?.id,
      actorUsername: request.user?.username,
      summary: 'バックアップ設定を更新',
      diff: {
        before: redactBackupConfig(beforeConfig),
        after: redactBackupConfig(config),
      },
      snapshotRedacted: redactBackupConfig(config),
    });

    return reply.status(200).send({ success: true });
  });

  // バックアップ対象の追加
  app.post('/backup/config/targets', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image', 'client-file', 'client-directory'] },
          source: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
          storage: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['local', 'dropbox'] },
              providers: { type: 'array', items: { type: 'string', enum: ['local', 'dropbox'] } },
            },
          },
          retention: {
            type: 'object',
            properties: {
              days: { type: 'number' },
              maxBackups: { type: 'number' },
            },
          },
          metadata: { type: 'object' },
        },
        required: ['kind', 'source'],
      },
    },
  }, async (request, reply) => {
    const body = addBackupTargetBodySchema.parse(request.body);

    // スケジュールのバリデーション
    if (body.schedule && body.schedule.trim()) {
      const cron = await import('node-cron');
      if (!cron.validate(body.schedule.trim())) {
        throw new ApiError(400, `Invalid cron schedule format: ${body.schedule}. Expected format: "分 時 日 月 曜日" (e.g., "0 4 * * *")`);
      }
    }

    const config = await BackupConfigLoader.load();

    // 新しいtargetを追加（Phase 2: providers配列に対応）
    const storage = body.storage?.providers && body.storage.providers.length > 0
      ? { providers: body.storage.providers }
      : body.storage?.provider
      ? { provider: body.storage.provider }
      : undefined;

    const newTarget: BackupConfig['targets'][number] = {
      kind: body.kind,
      source: body.source,
      schedule: body.schedule?.trim() || undefined,
      enabled: body.enabled ?? true,
      storage,
      retention: body.retention,
      metadata: body.metadata,
    };

    config.targets.push(newTarget);
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み（ターゲット追加を即時反映）
    const { getBackupScheduler } = await import('../../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();

    const historyService = new BackupConfigHistoryService();
    await historyService.recordChange({
      actionType: 'target_add',
      actorUserId: request.user?.id,
      actorUsername: request.user?.username,
      summary: `バックアップ対象を追加: ${newTarget.kind} ${newTarget.source}`,
      diff: { after: newTarget },
      snapshotRedacted: redactBackupConfig(config),
    });

    logger?.info({ target: newTarget }, '[BackupRoute] Backup target added');
    return reply.status(200).send({ success: true, target: newTarget });
  });

  // バックアップ対象の追加（テンプレートから）
  app.post('/backup/config/targets/from-template', {
    preHandler: [mustBeAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          templateId: { type: 'string' },
          overrides: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              schedule: { type: 'string' },
              enabled: { type: 'boolean' },
              storage: {
                type: 'object',
                properties: {
                  provider: { type: 'string', enum: ['local', 'dropbox'] },
                  providers: { type: 'array', items: { type: 'string', enum: ['local', 'dropbox'] } },
                },
              },
              retention: {
                type: 'object',
                properties: {
                  days: { type: 'number' },
                  maxBackups: { type: 'number' },
                },
              },
              metadata: { type: 'object' },
            },
          },
        },
        required: ['templateId'],
      },
    },
  }, async (request, reply) => {
    const body = addBackupTargetFromTemplateBodySchema.parse(request.body);
    const template = getBackupTargetTemplates().find((t) => t.id === body.templateId);
    if (!template) {
      throw new ApiError(404, `Template not found: ${body.templateId}`);
    }

    const mergedTarget: BackupConfig['targets'][number] = {
      ...template.target,
      ...body.overrides,
      storage: body.overrides?.storage ?? template.target.storage,
      retention: body.overrides?.retention ?? template.target.retention,
    };

    if (!mergedTarget.source || mergedTarget.source.trim() === '') {
      throw new ApiError(400, 'Template requires source override');
    }

    if (mergedTarget.schedule && mergedTarget.schedule.trim()) {
      const cron = await import('node-cron');
      if (!cron.validate(mergedTarget.schedule.trim())) {
        throw new ApiError(400, `Invalid cron schedule format: ${mergedTarget.schedule}. Expected format: "分 時 日 月 曜日" (e.g., "0 4 * * *")`);
      }
    }

    const config = await BackupConfigLoader.load();
    const duplicate = config.targets.find((t) => t.kind === mergedTarget.kind && t.source === mergedTarget.source);
    if (duplicate) {
      throw new ApiError(409, `Target already exists: ${mergedTarget.kind} ${mergedTarget.source}`);
    }

    config.targets.push(mergedTarget);
    await BackupConfigLoader.save(config);

    const { getBackupScheduler } = await import('../../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();

    const historyService = new BackupConfigHistoryService();
    await historyService.recordChange({
      actionType: 'target_add',
      actorUserId: request.user?.id,
      actorUsername: request.user?.username,
      summary: `テンプレートから追加: ${mergedTarget.kind} ${mergedTarget.source}`,
      diff: { after: mergedTarget, templateId: body.templateId },
      snapshotRedacted: redactBackupConfig(config),
    });

    logger?.info({ target: mergedTarget, templateId: body.templateId }, '[BackupRoute] Backup target added from template');
    return reply.status(200).send({ success: true, target: mergedTarget });
  });

  // バックアップ対象の更新
  app.put('/backup/config/targets/:index', {
    preHandler: [mustBeAdmin],
    schema: {
      params: {
        type: 'object',
        properties: {
          index: { type: 'number' },
        },
        required: ['index'],
      },
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['database', 'file', 'directory', 'csv', 'image', 'client-file', 'client-directory'] },
          source: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
          storage: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['local', 'dropbox'] },
              providers: { type: 'array', items: { type: 'string', enum: ['local', 'dropbox'] } },
            },
          },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { index: targetIndex } = updateBackupTargetParamsSchema.parse(request.params);
    const body = updateBackupTargetBodySchema.parse(request.body);

    // スケジュールのバリデーション
    if (body.schedule !== undefined && body.schedule.trim()) {
      const cron = await import('node-cron');
      if (!cron.validate(body.schedule.trim())) {
        throw new ApiError(400, `Invalid cron schedule format: ${body.schedule}. Expected format: "分 時 日 月 曜日" (e.g., "0 4 * * *")`);
      }
    }

    const config = await BackupConfigLoader.load();

    if (targetIndex < 0 || targetIndex >= config.targets.length) {
      throw new ApiError(400, `Invalid target index: ${targetIndex}`);
    }

    // 既存のtargetを更新（Phase 2: providers配列に対応）
    const existingTarget = config.targets[targetIndex];

    // storage設定の処理（providers優先、次にprovider、最後に既存設定）
    let storage: BackupConfig['targets'][number]['storage'] = existingTarget.storage;
    if (body.storage?.providers !== undefined) {
      storage = body.storage.providers.length > 0 ? { providers: body.storage.providers } : undefined;
    } else if (body.storage?.provider !== undefined) {
      storage = body.storage.provider ? { provider: body.storage.provider } : undefined;
    }

    const updatedTarget: BackupConfig['targets'][number] = {
      ...existingTarget,
      ...body,
      schedule: body.schedule !== undefined ? (body.schedule.trim() || undefined) : existingTarget.schedule,
      retention: body.retention !== undefined ? body.retention : existingTarget.retention,
      storage,
    };
    config.targets[targetIndex] = updatedTarget;

    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み（ターゲット更新を即時反映）
    const { getBackupScheduler } = await import('../../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();

    const historyService = new BackupConfigHistoryService();
    await historyService.recordChange({
      actionType: 'target_update',
      actorUserId: request.user?.id,
      actorUsername: request.user?.username,
      summary: `バックアップ対象を更新: ${updatedTarget.kind} ${updatedTarget.source}`,
      diff: { before: existingTarget, after: updatedTarget },
      snapshotRedacted: redactBackupConfig(config),
    });

    logger?.info({ index: targetIndex, target: config.targets[targetIndex] }, '[BackupRoute] Backup target updated');
    return reply.status(200).send({ success: true, target: config.targets[targetIndex] });
  });

  // バックアップ対象の削除
  app.delete('/backup/config/targets/:index', {
    preHandler: [mustBeAdmin],
  }, async (request, reply) => {
    const { index: targetIndex } = updateBackupTargetParamsSchema.parse(request.params);

    const config = await BackupConfigLoader.load();

    if (targetIndex < 0 || targetIndex >= config.targets.length) {
      throw new ApiError(400, `Invalid target index: ${targetIndex}`);
    }

    const deletedTarget = config.targets[targetIndex];
    config.targets.splice(targetIndex, 1);
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み（ターゲット削除を即時反映）
    const { getBackupScheduler } = await import('../../services/backup/backup-scheduler.js');
    await getBackupScheduler().reload();

    const historyService = new BackupConfigHistoryService();
    await historyService.recordChange({
      actionType: 'target_delete',
      actorUserId: request.user?.id,
      actorUsername: request.user?.username,
      summary: `バックアップ対象を削除: ${deletedTarget.kind} ${deletedTarget.source}`,
      diff: { before: deletedTarget },
      snapshotRedacted: redactBackupConfig(config),
    });

    logger?.info({ index: targetIndex, target: deletedTarget }, '[BackupRoute] Backup target deleted');
    return reply.status(200).send({ success: true, target: deletedTarget });
  });
}
