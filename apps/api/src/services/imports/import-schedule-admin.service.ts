import { emitDebugEvent } from '../../lib/debug-sink.js';
import { writeDebugLog } from '../../lib/debug-log.js';
import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { getCsvImportScheduler } from './csv-import-scheduler.js';
import { mapManualImportRunError } from './import-schedule-error-mapper.js';
import { detectGmailScheduleMinuteCollisions } from './import-schedule-policy.js';

type CsvImportSchedule = NonNullable<BackupConfig['csvImports']>[number];

type CsvImportSchedulerPort = {
  reload: () => Promise<void>;
  runImport: (scheduleId: string) => Promise<unknown>;
};

type BackupConfigStore = {
  load: () => Promise<BackupConfig>;
  save: (config: BackupConfig) => Promise<void>;
};

export type CsvImportScheduleCreateInput = {
  id: string;
  name?: string;
  provider?: 'dropbox' | 'gmail';
  targets?: CsvImportSchedule['targets'];
  employeesPath?: string;
  itemsPath?: string;
  schedule: string;
  enabled?: boolean;
  replaceExisting?: boolean;
  autoBackupAfterImport?: CsvImportSchedule['autoBackupAfterImport'];
  retryConfig?: CsvImportSchedule['retryConfig'];
};

export type CsvImportScheduleUpdateInput = {
  id?: string;
  name?: string;
  provider?: 'dropbox' | 'gmail';
  targets?: CsvImportSchedule['targets'];
  employeesPath?: string;
  itemsPath?: string;
  schedule?: string;
  enabled?: boolean;
  replaceExisting?: boolean;
  autoBackupAfterImport?: CsvImportSchedule['autoBackupAfterImport'];
  retryConfig?: CsvImportSchedule['retryConfig'];
};

export type RunScheduleContext = {
  requestId: string | null;
};

export class ImportScheduleAdminService {
  constructor(
    private readonly store: BackupConfigStore = BackupConfigLoader,
    private readonly getScheduler: () => CsvImportSchedulerPort = () => getCsvImportScheduler()
  ) {}

  async listSchedules(): Promise<CsvImportSchedule[]> {
    const config = await this.store.load();
    return config.csvImports ?? [];
  }

  async createSchedule(input: CsvImportScheduleCreateInput): Promise<{ schedule: CsvImportSchedule; warnings: string[] }> {
    const config = await this.store.load();

    if (config.csvImports?.some((schedule) => schedule.id === input.id)) {
      throw new ApiError(409, `スケジュールIDが既に存在します: ${input.id}`);
    }

    const newSchedule: CsvImportSchedule = {
      id: input.id,
      name: input.name,
      provider: input.provider,
      targets: input.targets,
      employeesPath: input.employeesPath,
      itemsPath: input.itemsPath,
      schedule: input.schedule,
      enabled: input.enabled ?? true,
      replaceExisting: input.replaceExisting ?? false,
      autoBackupAfterImport: input.autoBackupAfterImport ?? { enabled: false, targets: ['csv'] },
      retryConfig: input.retryConfig,
    };

    config.csvImports = [...(config.csvImports ?? []), newSchedule];
    const warnings = detectGmailScheduleMinuteCollisions(config);
    await this.store.save(config);
    await this.getScheduler().reload();

    return { schedule: newSchedule, warnings };
  }

  async updateSchedule(
    scheduleId: string,
    input: CsvImportScheduleUpdateInput
  ): Promise<{ schedule: CsvImportSchedule; warnings: string[] }> {
    const config = await this.store.load();
    const scheduleIndex = config.csvImports?.findIndex((schedule) => schedule.id === scheduleId);

    if (scheduleIndex === undefined || scheduleIndex === -1) {
      throw new ApiError(404, `スケジュールが見つかりません: ${scheduleId}`);
    }

    const existingSchedule = config.csvImports![scheduleIndex];
    const updatedSchedule: CsvImportSchedule = {
      ...existingSchedule,
      ...input,
      id: scheduleId,
      autoBackupAfterImport:
        input.autoBackupAfterImport ?? existingSchedule.autoBackupAfterImport ?? { enabled: false, targets: ['csv'] },
    };

    config.csvImports![scheduleIndex] = updatedSchedule;
    const warnings = detectGmailScheduleMinuteCollisions(config);
    await this.store.save(config);
    await this.getScheduler().reload();

    return { schedule: updatedSchedule, warnings };
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    const config = await this.store.load();
    const scheduleIndex = config.csvImports?.findIndex((schedule) => schedule.id === scheduleId);

    if (scheduleIndex === undefined || scheduleIndex === -1) {
      throw new ApiError(404, `スケジュールが見つかりません: ${scheduleId}`);
    }

    config.csvImports = config.csvImports!.filter((schedule) => schedule.id !== scheduleId);
    await this.store.save(config);
    await this.getScheduler().reload();
  }

  async runSchedule(scheduleId: string, context: RunScheduleContext): Promise<unknown> {
    void emitDebugEvent({
      location: 'imports.ts:1248',
      message: 'manual run request received',
      data: { scheduleId, reqId: context.requestId },
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId: 'H1',
    });
    await writeDebugLog({
      sessionId: 'debug-session',
      runId: 'run2',
      hypothesisId: 'H1',
      location: 'imports.ts:1249',
      message: 'manual run request received (file log)',
      data: { scheduleId, reqId: context.requestId },
      timestamp: Date.now(),
    });

    const config = await this.store.load();
    const schedule = config.csvImports?.find((item) => item.id === scheduleId);
    void emitDebugEvent({
      location: 'imports.ts:1252',
      message: 'loaded csv import schedules',
      data: {
        scheduleId,
        hasCsvImports: Array.isArray(config.csvImports),
        csvImportCount: config.csvImports?.length ?? 0,
        scheduleIds: (config.csvImports ?? []).map((item) => item.id),
      },
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId: 'H2',
    });
    await writeDebugLog({
      sessionId: 'debug-session',
      runId: 'run2',
      hypothesisId: 'H2',
      location: 'imports.ts:1253',
      message: 'loaded csv import schedules (file log)',
      data: {
        scheduleId,
        hasCsvImports: Array.isArray(config.csvImports),
        csvImportCount: config.csvImports?.length ?? 0,
        scheduleIds: (config.csvImports ?? []).map((item) => item.id),
        backupConfigPath: process.env.BACKUP_CONFIG_PATH ?? null,
      },
      timestamp: Date.now(),
    });

    if (!schedule) {
      void emitDebugEvent({
        location: 'imports.ts:1255',
        message: 'schedule not found',
        data: { scheduleId },
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'H1',
      });
      await writeDebugLog({
        sessionId: 'debug-session',
        runId: 'run2',
        hypothesisId: 'H1',
        location: 'imports.ts:1256',
        message: 'schedule not found (file log)',
        data: { scheduleId },
        timestamp: Date.now(),
      });
      throw new ApiError(404, `スケジュールが見つかりません: ${scheduleId}`);
    }

    const scheduler = this.getScheduler();
    void emitDebugEvent({
      location: 'imports.ts:1260',
      message: 'about to run scheduler import',
      data: { scheduleId, hasScheduler: !!scheduler },
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId: 'H4',
    });
    await writeDebugLog({
      sessionId: 'debug-session',
      runId: 'run2',
      hypothesisId: 'H4',
      location: 'imports.ts:1261',
      message: 'about to run scheduler import (file log)',
      data: { scheduleId, hasScheduler: !!scheduler },
      timestamp: Date.now(),
    });

    try {
      const summary = await scheduler.runImport(scheduleId);
      void emitDebugEvent({
        location: 'imports.ts:1262',
        message: 'scheduler.runImport succeeded',
        data: { scheduleId },
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'H4',
      });
      await writeDebugLog({
        sessionId: 'debug-session',
        runId: 'run2',
        hypothesisId: 'H4',
        location: 'imports.ts:1263',
        message: 'scheduler.runImport succeeded (file log)',
        data: { scheduleId },
        timestamp: Date.now(),
      });
      return summary;
    } catch (error) {
      void emitDebugEvent({
        location: 'imports.ts:1266',
        message: 'scheduler.runImport failed',
        data: {
          scheduleId,
          errorName: error instanceof Error ? error.name : 'unknown',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'H4',
      });
      await writeDebugLog({
        sessionId: 'debug-session',
        runId: 'run2',
        hypothesisId: 'H4',
        location: 'imports.ts:1267',
        message: 'scheduler.runImport failed (file log)',
        data: {
          scheduleId,
          errorName: error instanceof Error ? error.name : 'unknown',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        timestamp: Date.now(),
      });
      throw mapManualImportRunError(error, scheduleId);
    }
  }
}
