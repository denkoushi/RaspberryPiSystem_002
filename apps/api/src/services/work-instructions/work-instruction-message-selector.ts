import type { WorkInstructionImportMessageView } from './domain/types.js';
import type { WorkInstructionRepository } from './repositories/work-instruction-repository.port.js';
import {
  allocateWorkInstructionBatch,
  buildWorkInstructionGmailSearchQuery,
  isDueRetry,
  WORK_INSTRUCTION_BATCH_LIMIT,
  type WorkInstructionGmailIngestConfig,
} from './work-instruction-ingestion.policy.js';
import type { WorkInstructionGmailPort } from './work-instruction-gmail.port.js';

export type WorkInstructionMessageSelection = {
  scanned: number;
  newIds: string[];
  retryIds: string[];
  recordByMessageId: Map<string, WorkInstructionImportMessageView>;
};

/**
 * Select fresh inbox messages and independent DB retry work. Gmail IDs are
 * looked up in repository-sized pages so a large invalid history cannot hide
 * a new message or a due retry.
 */
export async function selectWorkInstructionMessages(input: {
  gmail: WorkInstructionGmailPort;
  repository: WorkInstructionRepository;
  config: WorkInstructionGmailIngestConfig;
  now?: Date;
}): Promise<WorkInstructionMessageSelection> {
  const now = input.now ?? new Date();
  const query = buildWorkInstructionGmailSearchQuery(input.config);
  const messageIds = await input.gmail.searchMessagesAll(query);
  const pendingRecords = await input.repository.readImportMessages({
    limit: WORK_INSTRUCTION_BATCH_LIMIT,
    offset: 0,
    mailCleanupPending: true,
    retryDueAt: now,
  });
  const currentRecords: WorkInstructionImportMessageView[] = [];
  for (let offset = 0; offset < messageIds.length; offset += 500) {
    const chunk = messageIds.slice(offset, offset + 500);
    // eslint-disable-next-line no-await-in-loop
    currentRecords.push(...await input.repository.readImportMessages({
      limit: chunk.length,
      offset: 0,
      gmailMessageIds: chunk,
    }));
  }
  const dueRetryRecords = await input.repository.readImportMessages({
    limit: WORK_INSTRUCTION_BATCH_LIMIT,
    offset: 0,
    outcome: 'RETRYABLE',
    retryDueAt: now,
  });
  const pendingRecordsForRecovery = await input.repository.readImportMessages({
    limit: WORK_INSTRUCTION_BATCH_LIMIT,
    offset: 0,
    outcome: 'PENDING',
    retryDueAt: now,
  });
  const processingRecordsForRecovery = await input.repository.readImportMessages({
    limit: WORK_INSTRUCTION_BATCH_LIMIT,
    offset: 0,
    outcome: 'PROCESSING',
    retryDueAt: now,
  });
  const records = [
    ...pendingRecords,
    ...currentRecords,
    ...dueRetryRecords,
    ...pendingRecordsForRecovery,
    ...processingRecordsForRecovery,
  ];
  const recordByMessageId = new Map(records.map((record) => [record.gmailMessageId, record]));
  const newIds = messageIds.filter((id) => !recordByMessageId.has(id));
  const retryRecords = new Map<string, WorkInstructionImportMessageView>();
  for (const record of records) {
    const due = (record.mailCleanupPending &&
      (!record.nextRetryAt || record.nextRetryAt.getTime() <= now.getTime())) || isDueRetry(record, now);
    if (due && !retryRecords.has(record.gmailMessageId)) retryRecords.set(record.gmailMessageId, record);
  }
  const retryIds = [...retryRecords.values()]
    .sort((left, right) => {
      // Match the repository's `nextRetryAt ASC, updatedAt ASC` ordering:
      // records without a retry timestamp (crash recovery) remain eligible,
      // but do not displace explicitly overdue retries.
      const leftDue = left.nextRetryAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightDue = right.nextRetryAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftDue - rightDue ||
        left.updatedAt.getTime() - right.updatedAt.getTime() ||
        left.gmailMessageId.localeCompare(right.gmailMessageId);
    })
    .map((record) => record.gmailMessageId);
  const selected = allocateWorkInstructionBatch(newIds, retryIds);
  return {
    scanned: messageIds.length,
    newIds: selected.newIds,
    retryIds: selected.retryIds,
    recordByMessageId,
  };
}
