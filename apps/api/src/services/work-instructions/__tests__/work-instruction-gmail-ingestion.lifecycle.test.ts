import { describe, expect, it, vi } from 'vitest';

import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { defaultBackupConfig } from '../../backup/backup-config.js';
import type { WorkInstructionRepository } from '../repositories/work-instruction-repository.port.js';
import type { WorkInstructionFileStorePort } from '../work-instruction-file-store.adapter.js';
import type { ImportJobStore, WorkInstructionImportJob } from '../work-instruction-import-job.store.js';
import { WorkInstructionGmailIngestionService } from '../work-instruction-gmail-ingestion.service.js';
import type { WorkInstructionGmailPort } from '../work-instruction-gmail.port.js';

const disabledConfig = {
  ...defaultBackupConfig,
  workInstructionGmailIngest: {
    enabled: false,
    subjectTokens: ['[Kakou-Dandori-photo]'],
  },
};

function unrelatedMessage(id: string): GmailMessage {
  return {
    id,
    threadId: id,
    labelIds: ['INBOX', 'UNREAD'],
    snippet: '',
    internalDateMs: 1,
    payload: { headers: [{ name: 'Subject', value: 'other mailbox owner' }] },
  };
}

function makeRepository() {
  return {
    readImportMessages: vi.fn(async () => []),
    readImportMessage: vi.fn(async () => null),
    recordImportMessage: vi.fn(async () => ({})),
    stageAssets: vi.fn(async () => []),
    applyPacket: vi.fn(),
    claimCleanupCandidates: vi.fn(async () => []),
    deleteAssetRecords: vi.fn(),
    readGroup: vi.fn(),
    readGroups: vi.fn(),
    readRows: vi.fn(),
    readAsset: vi.fn(),
  } as unknown as WorkInstructionRepository;
}

function makeFileStore(): WorkInstructionFileStorePort {
  return {
    writeStagedAssets: vi.fn(),
    read: vi.fn(),
    delete: vi.fn(),
  } as unknown as WorkInstructionFileStorePort;
}

function makeJobStore(): ImportJobStore {
  let current: WorkInstructionImportJob = {
    id: '00000000-0000-0000-0000-000000000001',
    type: 'WORK_INSTRUCTION_GMAIL',
    status: 'PENDING',
    summary: {},
    createdAt: new Date('2026-08-29T00:00:00Z'),
    completedAt: null,
  };
  return {
    create: vi.fn(async (input) => {
      current = { ...current, ...input, status: 'PENDING', completedAt: null };
      return current;
    }),
    update: vi.fn(async (_id, input) => {
      current = { ...current, ...input };
      return current;
    }),
    find: vi.fn(async () => current),
  };
}

function makeGmail(): WorkInstructionGmailPort {
  return {
    searchMessagesAll: vi.fn(async () => []),
    getMessage: vi.fn(async (id) => unrelatedMessage(id)),
    getAttachment: vi.fn(),
    markAsRead: vi.fn(),
    trashMessage: vi.fn(),
  } as unknown as WorkInstructionGmailPort;
}

function makeService(gmailFactory: ReturnType<typeof vi.fn>) {
  return new WorkInstructionGmailIngestionService({
    repository: makeRepository(),
    fileStore: makeFileStore(),
    jobStore: makeJobStore(),
    gmailFactory,
  });
}

describe('WorkInstructionGmailIngestionService lifecycle', () => {
  it('does not initialize Gmail when automatic polling is disabled', async () => {
    const gmailFactory = vi.fn();
    const service = makeService(gmailFactory);

    const summary = await service.ingestCycle({ config: disabledConfig, allowWait: false });

    expect(summary.selected).toBe(0);
    expect(gmailFactory).not.toHaveBeenCalled();
  });

  it('runs a manual no-message cycle even when automatic polling is disabled', async () => {
    const gmail = makeGmail();
    const gmailFactory = vi.fn(async () => gmail);
    const service = makeService(gmailFactory);

    await service.ingestCycle({ config: disabledConfig, allowWait: false, manual: true });

    expect(gmailFactory).toHaveBeenCalledWith(disabledConfig, { allowWait: false });
    expect(gmail.searchMessagesAll).toHaveBeenCalledTimes(1);
  });

  it('propagates no-wait to a manual message job while disabled', async () => {
    const gmail = makeGmail();
    const gmailFactory = vi.fn(async () => gmail);
    const service = makeService(gmailFactory);

    const job = await service.runJobNow({
      config: disabledConfig,
      messageId: 'manual-message',
      allowWait: false,
    });

    expect(gmailFactory).toHaveBeenCalledWith(disabledConfig, { allowWait: false });
    expect(job.status).toBe('COMPLETED');
    expect(gmail.getMessage).toHaveBeenCalledWith('manual-message');
  });

  it('rejects a concurrent manual cycle instead of silently completing it', async () => {
    const gmail = makeGmail();
    let release!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const gmailFactory = vi.fn(async () => {
      started();
      await hold;
      return gmail;
    });
    const service = makeService(gmailFactory);
    const first = service.ingestCycle({ config: disabledConfig, allowWait: false, manual: true });
    await running;

    await expect(service.ingestCycle({ config: disabledConfig, allowWait: false, manual: true }))
      .rejects.toThrow('already running');
    release();
    await first;
  });
});
