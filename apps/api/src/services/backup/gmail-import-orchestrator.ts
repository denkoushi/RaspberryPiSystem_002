import type { BackupConfig } from './backup-config.js';
import { logger } from '../../lib/logger.js';
import { AdaptiveRateController } from './adaptive-rate-controller.js';
import { GmailRequestGateService } from './gmail-request-gate.service.js';

type CsvImportSchedule = NonNullable<BackupConfig['csvImports']>[number];

function hasCsvDashboardTarget(schedule: CsvImportSchedule): boolean {
  return Array.isArray(schedule.targets) && schedule.targets.some((target) => target.type === 'csvDashboards');
}

function isGmailProvider(schedule: CsvImportSchedule, fallbackProvider: BackupConfig['storage']['provider']): boolean {
  return (schedule.provider ?? fallbackProvider) === 'gmail';
}

/**
 * Gmail csvDashboards 取り込みを単一サイクルで調停するオーケストレータ。
 */
export class GmailImportOrchestrator {
  private running = false;
  private readonly gate = new GmailRequestGateService();
  private readonly rateController = AdaptiveRateController.getInstance();

  constructor(
    private readonly deps: {
      executeSchedule: (params: {
        config: BackupConfig;
        importSchedule: CsvImportSchedule;
        isManual: boolean;
      }) => Promise<unknown>;
    }
  ) {}

  async runCycle(params: { config: BackupConfig; triggerScheduleId: string; isManual: boolean }): Promise<void> {
    const { config, triggerScheduleId, isManual } = params;
    if (this.running) {
      logger?.info(
        { triggerScheduleId },
        '[GmailImportOrchestrator] Cycle skipped because previous cycle is running'
      );
      return;
    }

    this.running = true;
    try {
      const gmailSchedules = (config.csvImports ?? []).filter(
        (schedule) => schedule.enabled && hasCsvDashboardTarget(schedule) && isGmailProvider(schedule, config.storage.provider)
      );
      if (gmailSchedules.length === 0) {
        return;
      }

      const gateState = await this.gate
        .getStateSnapshot()
        .catch(() => ({ state: 'NORMAL', cooldownUntil: null, relockLevel: 0 })) as {
        state: string;
        cooldownUntil: string | null;
        relockLevel: number;
      };
      logger?.info(
        {
          triggerScheduleId,
          scheduleCount: gmailSchedules.length,
          state: gateState.state,
          cooldownUntil: gateState.cooldownUntil,
          relockLevel: gateState.relockLevel,
          effectiveBatchSize: this.rateController.getBatchSize(),
        },
        '[GmailImportOrchestrator] Starting Gmail import cycle'
      );

      for (const schedule of gmailSchedules) {
        await this.deps.executeSchedule({
          config,
          importSchedule: schedule,
          isManual,
        });
      }
    } finally {
      this.running = false;
    }
  }
}

