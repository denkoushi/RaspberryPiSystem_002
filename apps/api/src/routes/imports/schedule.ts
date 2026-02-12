import type { FastifyInstance } from 'fastify';
import { validate as validateCron } from 'node-cron';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import { GmailReauthRequiredError, isInvalidGrantMessage } from '../../services/backup/gmail-oauth.service.js';
import { writeDebugLog } from '../../lib/debug-log.js';

const MIN_CSV_IMPORT_INTERVAL_MINUTES = 5;

function extractIntervalMinutes(schedule: string): number | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [minute, hour, dayOfMonth, month] = parts;
  if (hour !== '*' || dayOfMonth !== '*' || month !== '*') {
    return null;
  }
  if (minute === '*') {
    return 1;
  }
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2), 10);
    return Number.isInteger(interval) ? interval : null;
  }
  return null;
}

const csvImportTargetSchema = z.object({
  type: z.enum(['employees', 'items', 'measuringInstruments', 'riggingGears', 'machines', 'csvDashboards']),
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

  // === CSVインポートスケジュール管理API ===
  // スケジュール一覧取得
  app.get('/imports/schedule', { preHandler: mustBeAdmin }, async () => {
    const config = await BackupConfigLoader.load();
    return {
      schedules: config.csvImports || [],
    };
  });

  // スケジュール追加
  app.post('/imports/schedule', { preHandler: mustBeAdmin }, async (request) => {
    const body = csvImportScheduleSchema.parse(request.body ?? {});

    const config = await BackupConfigLoader.load();

    // IDの重複チェック
    if (config.csvImports?.some((s) => s.id === body.id)) {
      throw new ApiError(409, `スケジュールIDが既に存在します: ${body.id}`);
    }

    // スケジュールを追加
    const newSchedule = {
      id: body.id,
      name: body.name,
      provider: body.provider,
      targets: body.targets, // 新形式
      employeesPath: body.employeesPath, // 旧形式（後方互換）
      itemsPath: body.itemsPath, // 旧形式（後方互換）
      schedule: body.schedule,
      enabled: body.enabled ?? true,
      replaceExisting: body.replaceExisting ?? false,
      autoBackupAfterImport: body.autoBackupAfterImport ?? { enabled: false, targets: ['csv'] },
      retryConfig: body.retryConfig,
    };

    config.csvImports = [...(config.csvImports || []), newSchedule];
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み
    const { getCsvImportScheduler } = await import('../../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    await scheduler.reload();

    request.log.info({ scheduleId: body.id }, '[CSV Import Schedule] Schedule added');
    return { schedule: newSchedule };
  });

  // スケジュール更新
  app.put('/imports/schedule/:id', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    const body = csvImportScheduleUpdateSchema.parse(request.body ?? {});

    const config = await BackupConfigLoader.load();
    const scheduleIndex = config.csvImports?.findIndex((s) => s.id === id);

    if (scheduleIndex === undefined || scheduleIndex === -1) {
      throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
    }

    // スケジュールを更新
    const existingSchedule = config.csvImports![scheduleIndex];
    const updatedSchedule = {
      ...existingSchedule,
      ...body,
      id, // IDは変更不可
      // autoBackupAfterImportが指定されていない場合は既存の値を保持
      autoBackupAfterImport: body.autoBackupAfterImport ?? existingSchedule.autoBackupAfterImport ?? { enabled: false, targets: ['csv'] },
    };

    config.csvImports![scheduleIndex] = updatedSchedule;
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み
    const { getCsvImportScheduler } = await import('../../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    await scheduler.reload();

    request.log.info({ scheduleId: id }, '[CSV Import Schedule] Schedule updated');
    return { schedule: updatedSchedule };
  });

  // スケジュール削除
  app.delete('/imports/schedule/:id', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };

    const config = await BackupConfigLoader.load();
    const scheduleIndex = config.csvImports?.findIndex((s) => s.id === id);

    if (scheduleIndex === undefined || scheduleIndex === -1) {
      throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
    }

    // スケジュールを削除
    config.csvImports = config.csvImports!.filter((s) => s.id !== id);
    await BackupConfigLoader.save(config);

    // スケジューラーを再読み込み
    const { getCsvImportScheduler } = await import('../../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    await scheduler.reload();

    request.log.info({ scheduleId: id }, '[CSV Import Schedule] Schedule deleted');
    return { message: 'スケジュールを削除しました' };
  });

  // 手動実行
  app.post('/imports/schedule/:id/run', { preHandler: mustBeAdmin }, async (request) => {
    const { id } = request.params as { id: string };
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'imports.ts:1248', message: 'manual run request received', data: { scheduleId: id, reqId: request.id ?? null }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H1' }) }).catch(() => {});
    // #endregion
    // #region agent log
    await writeDebugLog({ sessionId: 'debug-session', runId: 'run2', hypothesisId: 'H1', location: 'imports.ts:1249', message: 'manual run request received (file log)', data: { scheduleId: id, reqId: request.id ?? null }, timestamp: Date.now() });
    // #endregion

    // スケジュールが存在するか確認
    const config = await BackupConfigLoader.load();
    const schedule = config.csvImports?.find((s) => s.id === id);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'imports.ts:1252', message: 'loaded csv import schedules', data: { scheduleId: id, hasCsvImports: Array.isArray(config.csvImports), csvImportCount: config.csvImports?.length ?? 0, scheduleIds: (config.csvImports ?? []).map((s) => s.id) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H2' }) }).catch(() => {});
    // #endregion
    // #region agent log
    await writeDebugLog({ sessionId: 'debug-session', runId: 'run2', hypothesisId: 'H2', location: 'imports.ts:1253', message: 'loaded csv import schedules (file log)', data: { scheduleId: id, hasCsvImports: Array.isArray(config.csvImports), csvImportCount: config.csvImports?.length ?? 0, scheduleIds: (config.csvImports ?? []).map((s) => s.id), backupConfigPath: process.env.BACKUP_CONFIG_PATH ?? null }, timestamp: Date.now() });
    // #endregion

    if (!schedule) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'imports.ts:1255', message: 'schedule not found', data: { scheduleId: id }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H1' }) }).catch(() => {});
      // #endregion
      // #region agent log
      await writeDebugLog({ sessionId: 'debug-session', runId: 'run2', hypothesisId: 'H1', location: 'imports.ts:1256', message: 'schedule not found (file log)', data: { scheduleId: id }, timestamp: Date.now() });
      // #endregion
      throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
    }

    const { getCsvImportScheduler } = await import('../../services/imports/csv-import-scheduler.js');
    const scheduler = getCsvImportScheduler();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'imports.ts:1260', message: 'about to run scheduler import', data: { scheduleId: id, hasScheduler: !!scheduler }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H4' }) }).catch(() => {});
    // #endregion
    // #region agent log
    await writeDebugLog({ sessionId: 'debug-session', runId: 'run2', hypothesisId: 'H4', location: 'imports.ts:1261', message: 'about to run scheduler import (file log)', data: { scheduleId: id, hasScheduler: !!scheduler }, timestamp: Date.now() });
    // #endregion

    try {
      const summary = await scheduler.runImport(id);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'imports.ts:1262', message: 'scheduler.runImport succeeded', data: { scheduleId: id }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H4' }) }).catch(() => {});
      // #endregion
      // #region agent log
      await writeDebugLog({ sessionId: 'debug-session', runId: 'run2', hypothesisId: 'H4', location: 'imports.ts:1263', message: 'scheduler.runImport succeeded (file log)', data: { scheduleId: id }, timestamp: Date.now() });
      // #endregion
      request.log.info({ scheduleId: id }, '[CSV Import Schedule] Manual import completed');
      return { message: 'インポートを実行しました', summary };
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'imports.ts:1266', message: 'scheduler.runImport failed', data: { scheduleId: id, errorName: error instanceof Error ? error.name : 'unknown', errorMessage: error instanceof Error ? error.message : String(error) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'H4' }) }).catch(() => {});
      // #endregion
      // #region agent log
      await writeDebugLog({ sessionId: 'debug-session', runId: 'run2', hypothesisId: 'H4', location: 'imports.ts:1267', message: 'scheduler.runImport failed (file log)', data: { scheduleId: id, errorName: error instanceof Error ? error.name : 'unknown', errorMessage: error instanceof Error ? error.message : String(error) }, timestamp: Date.now() });
      // #endregion
      request.log.error({ err: error, scheduleId: id }, '[CSV Import Schedule] Manual import failed');

      if (error instanceof GmailReauthRequiredError || isInvalidGrantMessage(error instanceof Error ? error.message : undefined)) {
        throw new ApiError(401, 'Gmailの再認可が必要です。管理コンソールの「OAuth認証」を実行してください。');
      }

      // ApiErrorの場合はstatusCodeを尊重して再スロー
      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof Error) {
        // 既に実行中の場合は409で返す
        if (
          error.message.includes('CSV import is already running') ||
          error.message.includes('already running')
        ) {
          throw new ApiError(409, `インポートは既に実行中です: ${id}`);
        }
        // スケジュールが見つからないエラーの場合のみ404
        // NOTE: 取り込み側（CSVダッシュボード列不足など）も「見つかりません」を含むため、誤判定しない
        if (
          error.message.includes('スケジュールが見つかりません') ||
          error.message.toLowerCase().includes('schedule not found')
        ) {
          throw new ApiError(404, `スケジュールが見つかりません: ${id}`);
        }
        throw new ApiError(500, `インポート実行に失敗しました: ${error.message}`);
      }
      throw new ApiError(500, 'インポート実行に失敗しました');
    }
  });
}
