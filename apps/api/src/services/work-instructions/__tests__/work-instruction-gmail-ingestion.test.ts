import { describe, expect, it, vi } from 'vitest';

import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { defaultBackupConfig } from '../../backup/backup-config.js';
import type { WorkInstructionRepository } from '../repositories/work-instruction-repository.port.js';
import type { WorkInstructionFileStorePort } from '../work-instruction-file-store.adapter.js';
import type { ImportJobStore } from '../work-instruction-import-job.store.js';
import { WorkInstructionGmailIngestionService } from '../work-instruction-gmail-ingestion.service.js';

function importMessage(gmailMessageId: string, outcome: 'INVALID' | 'RETRYABLE') {
  const now = new Date('2026-08-29T00:00:00Z');
  return {
    id: `record-${gmailMessageId}`,
    gmailMessageId,
    outcome,
    error: outcome === 'INVALID' ? 'invalid fixture' : null,
    nextRetryAt: outcome === 'RETRYABLE' ? new Date('2026-08-28T23:00:00Z') : null,
    mailCleanupPending: false,
    createdAt: now,
    updatedAt: now,
  } as const;
}

function message(messageId: string): GmailMessage {
  return {
    id: messageId,
    threadId: messageId,
    labelIds: ['INBOX', 'UNREAD'],
    snippet: '',
    internalDateMs: 1,
    payload: {
      mimeType: 'text/plain',
      headers: [{ name: 'Subject', value: 'an unrelated subject' }],
    },
  };
}

function fileStore(): WorkInstructionFileStorePort {
  return {
    writeStagedAssets: vi.fn(),
    read: vi.fn(),
    delete: vi.fn(),
  } as unknown as WorkInstructionFileStorePort;
}

function jobStore(): ImportJobStore {
  return {
    create: vi.fn(),
    update: vi.fn(),
    find: vi.fn(),
  } as unknown as ImportJobStore;
}

describe('WorkInstructionGmailIngestionService mailbox selection', () => {
  it('pages known Gmail IDs and still reaches a due retry behind more than 1000 invalid records', async () => {
    const inboxIds = Array.from({ length: 1001 }, (_, index) => `new-${index}`);
    const dueRetry = importMessage('retry-due', 'RETRYABLE');
    const readImportMessages = vi.fn(async (input: {
      gmailMessageIds?: ReadonlyArray<string>;
      outcome?: string;
      mailCleanupPending?: boolean;
      retryDueAt?: Date;
    }) => {
      if (input.gmailMessageIds) {
        return input.gmailMessageIds
          .filter((id) => id !== inboxIds[inboxIds.length - 1])
          .map((id) => importMessage(id, 'INVALID'));
      }
      if (input.outcome === 'RETRYABLE') return [dueRetry];
      return [];
    });
    const repository = {
      readImportMessages,
      readImportMessage: vi.fn(async () => null),
      recordImportMessage: vi.fn(),
      stageAssets: vi.fn(),
      applyPacket: vi.fn(),
      claimCleanupCandidates: vi.fn(),
      deleteAssetRecords: vi.fn(),
      readGroup: vi.fn(),
      readGroups: vi.fn(),
      readRows: vi.fn(),
      readAsset: vi.fn(),
    } as unknown as WorkInstructionRepository;
    const getMessage = vi.fn(async (id: string) => message(id));
    const gmail = {
      searchMessagesAll: vi.fn(async () => inboxIds),
      getMessage,
      getAttachment: vi.fn(),
      markAsRead: vi.fn(),
      trashMessage: vi.fn(),
    };
    const service = new WorkInstructionGmailIngestionService({
      repository,
      fileStore: fileStore(),
      jobStore: jobStore(),
      gmailFactory: vi.fn(async () => gmail),
    });
    const config = {
      ...defaultBackupConfig,
      workInstructionGmailIngest: {
        enabled: true,
        subjectTokens: ['[WORK-INSTRUCTION]', '[WORK-INSTRUCTION-TEST]'] as const,
      },
    };

    const summary = await service.ingestCycle({ config, allowWait: false });

    expect(summary.selected).toBe(2);
    expect(summary.newSelected).toBe(1);
    expect(summary.retrySelected).toBe(1);
    expect(getMessage.mock.calls.map(([id]) => id)).toEqual(['new-1000', 'retry-due']);
    const idLookups = readImportMessages.mock.calls
      .map(([input]) => input)
      .filter((input) => input.gmailMessageIds);
    expect(idLookups).toHaveLength(3);
    expect(idLookups.every((input) => (input.gmailMessageIds?.length ?? 0) <= 500)).toBe(true);
    const recoveryLookups = readImportMessages.mock.calls
      .map(([input]) => input)
      .filter((input) => input.outcome === 'PENDING' || input.outcome === 'PROCESSING');
    expect(recoveryLookups).toHaveLength(2);
    expect(recoveryLookups.every((input) => input.retryDueAt instanceof Date)).toBe(true);
  });
});
