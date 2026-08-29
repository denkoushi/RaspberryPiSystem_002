import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { resolveGmailApiClientFromBackupConfig } from '../gmail/gmail-api-client.factory.js';
import { prismaImportJobStore } from './work-instruction-import-job.store.js';
import { PrismaWorkInstructionRepository } from './repositories/prisma-work-instruction.repository.js';
import { WorkInstructionGmailIngestionService } from './work-instruction-gmail-ingestion.service.js';
import { WorkInstructionFileStoreAdapter } from './work-instruction-file-store.adapter.js';
import { WorkInstructionReadService } from './work-instruction-read.service.js';

export type WorkInstructionServices = {
  repository: PrismaWorkInstructionRepository;
  files: WorkInstructionFileStoreAdapter;
  ingestion: WorkInstructionGmailIngestionService;
  read: WorkInstructionReadService;
};

let services: WorkInstructionServices | null = null;

export function getWorkInstructionServices(): WorkInstructionServices {
  if (services) return services;
  const runtime = getFileStorageRuntime();
  const repository = new PrismaWorkInstructionRepository();
  const files = new WorkInstructionFileStoreAdapter(runtime.store);
  const ingestion = new WorkInstructionGmailIngestionService({
    repository,
    fileStore: files,
    jobStore: prismaImportJobStore,
    gmailFactory: (config, options) => resolveGmailApiClientFromBackupConfig(config, options),
  });
  services = {
    repository,
    files,
    ingestion,
    read: new WorkInstructionReadService(repository, files),
  };
  return services;
}

export function resetWorkInstructionServicesForTests(): void {
  services = null;
}
