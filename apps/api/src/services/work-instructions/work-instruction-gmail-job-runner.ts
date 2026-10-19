import { logger } from '../../lib/logger.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import {
  type ImportJobStore,
  type WorkInstructionImportJob,
} from './work-instruction-import-job.store.js';

export type WorkInstructionJobRunOptions = {
  config?: BackupConfig;
  messageId?: string;
  allowWait: boolean;
};

export type WorkInstructionJobRunnerOptions<TSummary> = {
  jobs: ImportJobStore;
  jobType: string;
  run: (options: Omit<WorkInstructionJobRunOptions, 'config'> & {
    config: BackupConfig;
    manual: true;
  }) => Promise<TSummary>;
};

/** Reuses ImportJob while keeping job lifecycle out of the ingest application. */
export class WorkInstructionGmailJobRunner<TSummary> {
  private readonly jobs: ImportJobStore;
  private readonly jobType: string;
  private readonly run: WorkInstructionJobRunnerOptions<TSummary>['run'];

  constructor(options: WorkInstructionJobRunnerOptions<TSummary>) {
    this.jobs = options.jobs;
    this.jobType = options.jobType;
    this.run = options.run;
  }

  createJob(messageId?: string): Promise<WorkInstructionImportJob> {
    return this.jobs.create({
      type: this.jobType,
      status: 'PENDING',
      summary: { messageId: messageId ?? null },
    });
  }

  async startJob(options: WorkInstructionJobRunOptions): Promise<WorkInstructionImportJob> {
    const job = await this.createJob(options.messageId);
    void this.runJob(job.id, options).catch((error) => {
      logger.error({ err: error, jobId: job.id }, '[WorkInstructionGmailIngestion] background job failed');
    });
    return job;
  }

  async runJobNow(options: WorkInstructionJobRunOptions): Promise<WorkInstructionImportJob> {
    const job = await this.createJob(options.messageId);
    await this.runJob(job.id, options);
    return (await this.getJob(job.id)) ?? job;
  }

  getJob(id: string): Promise<WorkInstructionImportJob | null> {
    return this.jobs.find(id, this.jobType);
  }

  private async runJob(jobId: string, options: WorkInstructionJobRunOptions): Promise<void> {
    await this.jobs.update(jobId, {
      status: 'PROCESSING',
      summary: { messageId: options.messageId ?? null },
    });
    try {
      const config = options.config ?? (await BackupConfigLoader.load());
      const summary = await this.run({ ...options, config, manual: true });
      await this.jobs.update(jobId, {
        status: 'COMPLETED',
        summary: summary as Record<string, unknown>,
        completedAt: new Date(),
      });
    } catch (error) {
      await this.jobs.update(jobId, {
        status: 'FAILED',
        summary: { error: error instanceof Error ? error.message : String(error) },
        completedAt: new Date(),
      });
      throw error;
    }
  }
}
