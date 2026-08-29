import { logger } from '../../lib/logger.js';
import type { BackupConfig } from '../backup/backup-config.js';
import type { GmailMessage } from '../backup/gmail-api-client.js';
import { isWorkInstructionGmailSubject } from '../gmail/gmail-subject-reservation.policy.js';
import { WorkInstructionManifestError } from './domain/manifest.js';
import type {
  WorkInstructionImportMessageView,
  WorkInstructionImportOutcome,
} from './domain/types.js';
import type { WorkInstructionRepository } from './repositories/work-instruction-repository.port.js';
import type { WorkInstructionFileStorePort } from './work-instruction-file-store.adapter.js';
import type { ImportJobStore, WorkInstructionImportJob } from './work-instruction-import-job.store.js';
import { acknowledgeWorkInstructionMessage } from './work-instruction-mail-acknowledger.js';
import {
  extractEmail,
  isTerminalOutcome,
  WORK_INSTRUCTION_BATCH_LIMIT,
  WORK_INSTRUCTION_IMPORT_JOB_TYPE,
  WORK_INSTRUCTION_RETRY_DELAY_MS,
} from './work-instruction-ingestion.policy.js';
import {
  WorkInstructionGmailJobRunner,
  type WorkInstructionJobRunOptions,
} from './work-instruction-gmail-job-runner.js';
import type { WorkInstructionGmailPort } from './work-instruction-gmail.port.js';
import { selectWorkInstructionMessages } from './work-instruction-message-selector.js';

export type { WorkInstructionImportJob } from './work-instruction-import-job.store.js';
export type { WorkInstructionGmailPort } from './work-instruction-gmail.port.js';
export {
  allocateWorkInstructionBatch,
  buildWorkInstructionGmailSearchQuery,
  WORK_INSTRUCTION_NEW_RESERVATION,
  WORK_INSTRUCTION_POLL_INTERVAL_MINUTES,
  WORK_INSTRUCTION_BATCH_LIMIT,
  WORK_INSTRUCTION_IMPORT_JOB_TYPE,
  WORK_INSTRUCTION_RETRY_DELAY_MS,
} from './work-instruction-ingestion.policy.js';
import {
  getGmailMessageFrom,
  getGmailMessageSubject,
  resolveWorkInstructionGmailPacket,
} from './work-instruction-gmail-packet-resolver.js';
export type { WorkInstructionGmailIngestConfig } from './work-instruction-ingestion.policy.js';

export type WorkInstructionCycleSummary = {
  scanned: number;
  selected: number;
  newSelected: number;
  retrySelected: number;
  applied: number;
  duplicate: number;
  stale: number;
  conflict: number;
  invalid: number;
  retryable: number;
  skipped: number;
  acknowledged: number;
  acknowledgementPending: number;
  errors: string[];
};

export type WorkInstructionCycleOptions = {
  config: BackupConfig;
  allowWait: boolean;
  messageId?: string;
  /** Manual API invocation may run even when automatic polling is disabled. */
  manual?: boolean;
};

type IngestMessageResult = {
  outcome?: WorkInstructionImportOutcome;
  skipped?: boolean;
  acknowledged?: boolean;
  acknowledgementPending?: boolean;
  error?: string;
};

function emptySummary(): WorkInstructionCycleSummary {
  return {
    scanned: 0,
    selected: 0,
    newSelected: 0,
    retrySelected: 0,
    applied: 0,
    duplicate: 0,
    stale: 0,
    conflict: 0,
    invalid: 0,
    retryable: 0,
    skipped: 0,
    acknowledged: 0,
    acknowledgementPending: 0,
    errors: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInvalidInputError(error: unknown): boolean {
  return error instanceof WorkInstructionManifestError;
}

export class WorkInstructionGmailIngestionService {
  private running = false;
  private readonly repository: WorkInstructionRepository;
  private readonly files: WorkInstructionFileStorePort;
  private readonly gmailFactory: (
    config: BackupConfig,
    options: { allowWait: boolean }
  ) => Promise<WorkInstructionGmailPort>;
  private readonly jobRunner: WorkInstructionGmailJobRunner<WorkInstructionCycleSummary>;
  private readonly activeAssetIds = new Set<string>();

  constructor(options: {
    repository: WorkInstructionRepository;
    fileStore: WorkInstructionFileStorePort;
    jobStore: ImportJobStore;
    gmailFactory: (
      config: BackupConfig,
      options: { allowWait: boolean }
    ) => Promise<WorkInstructionGmailPort>;
  }) {
    this.repository = options.repository;
    this.files = options.fileStore;
    this.gmailFactory = options.gmailFactory;
    this.jobRunner = new WorkInstructionGmailJobRunner({
      jobs: options.jobStore,
      jobType: WORK_INSTRUCTION_IMPORT_JOB_TYPE,
      run: (runOptions) => runOptions.messageId
        ? this.ingestMessage({
          config: runOptions.config,
          allowWait: runOptions.allowWait,
          messageId: runOptions.messageId,
          manual: true,
        })
        : this.ingestCycle({
          config: runOptions.config,
          allowWait: runOptions.allowWait,
          manual: true,
        }),
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  createJob(messageId?: string): Promise<WorkInstructionImportJob> {
    return this.jobRunner.createJob(messageId);
  }

  startJob(options: WorkInstructionJobRunOptions): Promise<WorkInstructionImportJob> {
    return this.jobRunner.startJob(options);
  }

  /** Scheduler entry point: retain the existing ImportJob row while awaiting completion. */
  runJobNow(options: WorkInstructionJobRunOptions): Promise<WorkInstructionImportJob> {
    return this.jobRunner.runJobNow(options);
  }

  getJob(id: string): Promise<WorkInstructionImportJob | null> {
    return this.jobRunner.getJob(id);
  }

  async ingestMessage(options: WorkInstructionCycleOptions & { messageId: string }): Promise<WorkInstructionCycleSummary> {
    return this.runCycle(options);
  }

  async ingestCycle(options: WorkInstructionCycleOptions): Promise<WorkInstructionCycleSummary> {
    return this.runCycle(options);
  }

  private async runCycle(options: WorkInstructionCycleOptions): Promise<WorkInstructionCycleSummary> {
    if (this.running) {
      if (options.manual || options.messageId) {
        throw new Error('work-instruction ingest is already running');
      }
      return { ...emptySummary(), errors: ['work-instruction ingest is already running'] };
    }
    // A manual API request is explicitly allowed to retry a message while
    // automatic polling remains disabled by configuration.
    if (!options.messageId && !options.manual && !options.config.workInstructionGmailIngest?.enabled) {
      return emptySummary();
    }
    this.running = true;
    const summary = emptySummary();
    try {
      const gmail = await this.gmailFactory(options.config, { allowWait: options.allowWait });
      if (options.messageId) {
        summary.selected = 1;
        const result = await this.processMessage(gmail, options.messageId, true, undefined, options.config);
        this.addResult(summary, result);
        return summary;
      }

      const ingestConfig = options.config.workInstructionGmailIngest ?? {
        enabled: false,
        subjectTokens: ['[WORK-INSTRUCTION]', '[WORK-INSTRUCTION-TEST]'] as const,
        fromEmail: undefined,
      };
      const selected = await selectWorkInstructionMessages({
        gmail,
        repository: this.repository,
        config: ingestConfig,
      });
      summary.scanned = selected.scanned;
      summary.selected = selected.newIds.length + selected.retryIds.length;
      summary.newSelected = selected.newIds.length;
      summary.retrySelected = selected.retryIds.length;

      for (const id of [...selected.newIds, ...selected.retryIds]) {
        // Sequential processing keeps Gmail request order deterministic while
        // the shared FIFO gate still arbitrates with other importers.
        // eslint-disable-next-line no-await-in-loop
        const result = await this.processMessage(
          gmail,
          id,
          false,
          selected.recordByMessageId.get(id),
          options.config
        );
        this.addResult(summary, result);
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  private addResult(summary: WorkInstructionCycleSummary, result: IngestMessageResult): void {
    if (result.skipped) summary.skipped += 1;
    if (result.acknowledged) summary.acknowledged += 1;
    if (result.acknowledgementPending) summary.acknowledgementPending += 1;
    if (result.error) summary.errors.push(result.error);
    switch (result.outcome) {
      case 'APPLIED': summary.applied += 1; break;
      case 'DUPLICATE': summary.duplicate += 1; break;
      case 'STALE': summary.stale += 1; break;
      case 'CONFLICT': summary.conflict += 1; break;
      case 'INVALID': summary.invalid += 1; break;
      case 'RETRYABLE': summary.retryable += 1; break;
      default: break;
    }
  }

  private async processMessage(
    gmail: WorkInstructionGmailPort,
    messageId: string,
    manual: boolean,
    known?: WorkInstructionImportMessageView,
    config?: BackupConfig
  ): Promise<IngestMessageResult> {
    const existing = known ?? (await this.repository.readImportMessage(messageId));
    if (existing?.mailCleanupPending) {
      return acknowledgeWorkInstructionMessage({
        repository: this.repository,
        gmail,
        messageId,
        outcome: existing.outcome,
        error: existing.error,
      });
    }
    if (existing && isTerminalOutcome(existing.outcome) && !manual) {
      return { outcome: existing.outcome };
    }
    if (existing && isTerminalOutcome(existing.outcome) && manual && existing.outcome !== 'INVALID') {
      return { outcome: existing.outcome };
    }

    let processingRecorded = false;
    let message: GmailMessage;
    try {
      message = await gmail.getMessage(messageId);
      const subject = getGmailMessageSubject(message);
      if (!isWorkInstructionGmailSubject(subject)) {
        // A Gmail search can return a partial-token collision. It remains
        // unread and belongs to its original mailbox owner.
        return { skipped: true };
      }
      const expectedFrom = extractEmail(config?.workInstructionGmailIngest?.fromEmail);
      if (expectedFrom && extractEmail(getGmailMessageFrom(message)) !== expectedFrom) {
        return { skipped: true };
      }

      await this.repository.recordImportMessage({
        gmailMessageId: messageId,
        outcome: 'PROCESSING',
        error: null,
        nextRetryAt: null,
        mailCleanupPending: false,
        expectedOutcome: existing?.outcome ?? null,
      });
      processingRecorded = true;

      const resolved = await resolveWorkInstructionGmailPacket({ message, client: gmail });
      const staged = await this.repository.stageAssets({ assets: resolved.assets, now: new Date() });
      staged.forEach((asset) => this.activeAssetIds.add(asset.assetId));
      try {
        await this.files.writeStagedAssets(staged, resolved.assetBytes);
        const applied = await this.repository.applyPacket({
          packet: resolved.packet,
          stagedAssets: staged,
          now: new Date(),
        });
        const outcome = applied.outcome;
        if (outcome === 'CONFLICT') {
          await this.repository.recordImportMessage({
            gmailMessageId: messageId,
            outcome,
            error: '同一更新日時で内容が異なるため適用しませんでした',
            nextRetryAt: null,
            mailCleanupPending: false,
            expectedOutcome: 'PROCESSING',
          });
          return { outcome };
        }
        return acknowledgeWorkInstructionMessage({
          repository: this.repository,
          gmail,
          messageId,
          outcome,
          error: resolved.warnings.join('; ') || null,
        });
      } finally {
        staged.forEach((asset) => this.activeAssetIds.delete(asset.assetId));
      }
    } catch (error) {
      const invalid = isInvalidInputError(error);
      const outcome: WorkInstructionImportOutcome = invalid ? 'INVALID' : 'RETRYABLE';
      const nextRetryAt = invalid ? null : new Date(Date.now() + WORK_INSTRUCTION_RETRY_DELAY_MS);
      try {
        await this.repository.recordImportMessage({
          gmailMessageId: messageId,
          outcome,
          error: errorMessage(error),
          nextRetryAt,
          mailCleanupPending: false,
          expectedOutcome: processingRecorded ? 'PROCESSING' : (existing?.outcome ?? null),
        });
      } catch (recordError) {
        logger.error(
          { err: recordError, messageId },
          '[WorkInstructionGmailIngestion] failed to record message outcome'
        );
      }
      return { outcome, error: errorMessage(error) };
    }
  }

  async cleanupAssets(now = new Date()): Promise<{ deleted: number; failed: number }> {
    const candidates = await this.repository.claimCleanupCandidates({
      now,
      limit: WORK_INSTRUCTION_BATCH_LIMIT,
      activeAssetIds: [...this.activeAssetIds],
    });
    let deleted = 0;
    let failed = 0;
    const deletedIds: string[] = [];
    for (const candidate of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.files.delete(candidate);
        deletedIds.push(candidate.assetId);
        deleted += 1;
      } catch (error) {
        failed += 1;
        logger.error({ err: error, assetId: candidate.assetId }, '[WorkInstructionGmailIngestion] asset cleanup failed');
      }
    }
    if (deletedIds.length > 0) {
      await this.repository.deleteAssetRecords({ assetIds: deletedIds });
    }
    return { deleted, failed };
  }
}
