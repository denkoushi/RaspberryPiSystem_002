import type { FastifyInstance } from 'fastify';
import { validate as validateCron } from 'node-cron';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { ImportScheduleAdminService } from '../../services/imports/import-schedule-admin.service.js';
import {
  extractIntervalMinutes,
  MIN_CSV_IMPORT_INTERVAL_MINUTES,
} from '../../services/imports/import-schedule-policy.js';

const csvImportTargetSchema = z.object({
  type: z.enum(['employees', 'items', 'measuringInstruments', 'riggingGears', 'machines', 'csvDashboards', 'productionActualHours']),
  source: z.string().min(1, 'sourceは必須です'),
});

const csvImportScheduleSchema = z.object({
  id: z.string().min(1, 'IDは必須です'),
  name: z.string().optional(),
  provider: z.enum(['dropbox', 'gmail']).optional(), // プロバイダーを選択可能に（オプション、デフォルト: storage.provider）
  // 新形式: targets配列
  targets: z.array(csvImportTargetSchema).optional(),
  // 旧形式: 後方互換のため残す
  employeesPath: z.string().optional(), // Gmailの場合は件名パターン、Dropboxの場合はパス
  itemsPath: z.string().optional(), // Gmailの場合は件名パターン、Dropboxの場合はパス
  schedule: z.string().min(1, 'スケジュール（cron形式）は必須です'),
  enabled: z.boolean().optional().default(true),
  replaceExisting: z.boolean().optional().default(false),
  autoBackupAfterImport: z.object({
    enabled: z.boolean().default(false),
    targets: z.array(z.enum(['csv', 'database', 'all'])).default(['csv']),
  }).optional().default({ enabled: false, targets: ['csv'] }),
  retryConfig: z.object({
    maxRetries: z.number().min(0).default(3),
    retryInterval: z.number().min(1).default(60), // 秒
    exponentialBackoff: z.boolean().default(true),
  }).optional(),
}).refine((data) => {
  // 新形式または旧形式のいずれかが必須
  if (data.targets && data.targets.length > 0) {
    return true;
  }
  return data.employeesPath || data.itemsPath;
}, {
  message: 'targets または employeesPath/itemsPath のいずれかを指定してください',
}).refine((data) => {
  // 新形式の場合はバリデーション不要（各インポータで処理）
  if (data.targets && data.targets.length > 0) {
    return true;
  }
  // 旧形式のバリデーション
  // Gmailの場合は.csvで終わる必要がない、Dropboxの場合は.csvで終わる必要がある
  if (data.provider === 'gmail') {
    return true;
  }
  const isDropbox = data.provider === 'dropbox' || !data.provider;
  if (isDropbox) {
    if (data.employeesPath && !data.employeesPath.match(/\.csv$/i)) {
      return false;
    }
    if (data.itemsPath && !data.itemsPath.match(/\.csv$/i)) {
      return false;
    }
  }
  return true;
}, {
  message: 'Dropboxの場合、employeesPathとitemsPathは.csvで終わる必要があります',
}).superRefine((data, ctx) => {
  if (!validateCron(data.schedule)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule'],
      message: 'スケジュール（cron形式）が不正です',
    });
    return;
  }
  const interval = extractIntervalMinutes(data.schedule);
  if (interval !== null && interval < MIN_CSV_IMPORT_INTERVAL_MINUTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule'],
      message: `スケジュール間隔は${MIN_CSV_IMPORT_INTERVAL_MINUTES}分以上で指定してください`,
    });
  }
});

// スケジュール更新用スキーマ（すべてのフィールドをオプショナルに）
const csvImportScheduleUpdateSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().optional(),
  provider: z.enum(['dropbox', 'gmail']).optional(),
  // 新形式: targets配列
  targets: z.array(csvImportTargetSchema).optional(),
  // 旧形式: 後方互換のため残す
  employeesPath: z.string().optional(),
  itemsPath: z.string().optional(),
  schedule: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  replaceExisting: z.boolean().optional(),
  autoBackupAfterImport: z.object({
    enabled: z.boolean().default(false),
    targets: z.array(z.enum(['csv', 'database', 'all'])).default(['csv']),
  }).optional(),
  retryConfig: z.object({
    maxRetries: z.number().min(0).default(3),
    retryInterval: z.number().min(1).default(60),
    exponentialBackoff: z.boolean().default(true),
  }).optional(),
}).refine((data) => {
  // 更新時は既存の値が保持されるため、新形式または旧形式のいずれかが存在すればOK
  if (data.targets && data.targets.length > 0) {
    return true;
  }
  if (data.employeesPath || data.itemsPath) {
    return true;
  }
  // どちらも指定されていない場合は、既存の値が保持されるためOK
  return true;
}, {
  message: 'targets または employeesPath/itemsPath のいずれかを指定してください',
}).refine((data) => {
  // 新形式の場合はバリデーション不要
  if (data.targets && data.targets.length > 0) {
    return true;
  }
  // 旧形式のバリデーション
  if (data.provider === 'gmail') {
    return true;
  }
  const isDropbox = data.provider === 'dropbox' || !data.provider;
  if (isDropbox) {
    if (data.employeesPath && !data.employeesPath.match(/\.csv$/i)) {
      return false;
    }
    if (data.itemsPath && !data.itemsPath.match(/\.csv$/i)) {
      return false;
    }
  }
  return true;
}, {
  message: 'Dropboxの場合、employeesPathとitemsPathは.csvで終わる必要があります',
}).superRefine((data, ctx) => {
  if (!data.schedule) {
    return;
  }
  if (!validateCron(data.schedule)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule'],
      message: 'スケジュール（cron形式）が不正です',
    });
    return;
  }
  const interval = extractIntervalMinutes(data.schedule);
  if (interval !== null && interval < MIN_CSV_IMPORT_INTERVAL_MINUTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule'],
      message: `スケジュール間隔は${MIN_CSV_IMPORT_INTERVAL_MINUTES}分以上で指定してください`,
    });
  }
});

export async function registerImportScheduleRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');
  const scheduleAdminService = new ImportScheduleAdminService();

  // === CSVインポートスケジュール管理API ===
  // スケジュール一覧取得
  app.get('/imports/schedule', { preHandler: mustBeAdmin }, async () => {
    return {
      schedules: await scheduleAdminService.listSchedules(),
    };
  });

  // スケジュール追加
  app.post('/imports/schedule', { preHandler: mustBeAdmin }, async (request) => {
    const body = csvImportScheduleSchema.parse(request.body ?? {});
    const { schedule, warnings } = await scheduleAdminService.createSchedule(body);

    request.log.info({ scheduleId: body.id }, '[CSV Import Schedule] Schedule added');
    return { schedule, warnings };
  });

  // スケジュール更新
  app.put('/imports/schedule/:id', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = csvImportScheduleUpdateSchema.parse(request.body ?? {});
    const { schedule, warnings } = await scheduleAdminService.updateSchedule(id, body);

    request.log.info({ scheduleId: id }, '[CSV Import Schedule] Schedule updated');
    return { schedule, warnings };
  });

  // スケジュール削除
  app.delete('/imports/schedule/:id', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    await scheduleAdminService.deleteSchedule(id);

    request.log.info({ scheduleId: id }, '[CSV Import Schedule] Schedule deleted');
    return { message: 'スケジュールを削除しました' };
  });

  // 手動実行
  app.post('/imports/schedule/:id/run', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    try {
      const summary = await scheduleAdminService.runSchedule(id, {
        requestId: request.id ?? null,
      });
      request.log.info({ scheduleId: id }, '[CSV Import Schedule] Manual import completed');
      return { message: 'インポートを実行しました', summary };
    } catch (error) {
      request.log.error({ err: error, scheduleId: id }, '[CSV Import Schedule] Manual import failed');
      throw error;
    }
  });
}
