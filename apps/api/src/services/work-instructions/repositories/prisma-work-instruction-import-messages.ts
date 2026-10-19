import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import type {
  WorkInstructionImportMessageView,
  WorkInstructionImportOutcome
} from '../domain/types.js';
import type {
  RecordWorkInstructionImportMessageInput,
  WorkInstructionImportMessagesQuery
} from './work-instruction-repository.port.js';
import type {
  WorkInstructionDbClient,
  WorkInstructionImportMessageRecord
} from './prisma-work-instruction.persistence.types.js';

const IMPORT_MESSAGE_LOCK_NAMESPACE = 0x57494e58;
const TERMINAL_IMPORT_OUTCOMES: ReadonlySet<WorkInstructionImportOutcome> = new Set([
  'APPLIED',
  'DUPLICATE',
  'STALE',
  'CONFLICT',
  'INVALID'
]);

function isTerminalImportOutcome(outcome: WorkInstructionImportOutcome): boolean {
  return TERMINAL_IMPORT_OUTCOMES.has(outcome);
}

function assertPage(input: { limit: number; offset: number }): void {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 500) {
    throw new Error('limit must be an integer between 1 and 500');
  }
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
}

function toImportMessageView(record: WorkInstructionImportMessageRecord): WorkInstructionImportMessageView {
  return {
    id: record.id,
    gmailMessageId: record.gmailMessageId,
    outcome: record.outcome as WorkInstructionImportOutcome,
    error: record.error,
    nextRetryAt: record.nextRetryAt,
    mailCleanupPending: record.mailCleanupPending,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

async function lockImportMessage(tx: WorkInstructionDbClient, gmailMessageId: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(${IMPORT_MESSAGE_LOCK_NAMESPACE}::int4, hashtext(${gmailMessageId}::text)::int4)
  `);
}

export async function recordWorkInstructionImportMessage(
  db: PrismaClient,
  input: RecordWorkInstructionImportMessageInput
): Promise<WorkInstructionImportMessageView> {
  if (!input.gmailMessageId.trim()) throw new Error('gmailMessageId is required');
  return db.$transaction(async (tx) => {
    await lockImportMessage(tx, input.gmailMessageId);
    const current = await tx.workInstructionImportMessage.findUnique({ where: { gmailMessageId: input.gmailMessageId } });
    if (!current) {
      const created = await tx.workInstructionImportMessage.create({
        data: {
          gmailMessageId: input.gmailMessageId,
          outcome: input.outcome,
          error: input.error ?? null,
          nextRetryAt: input.nextRetryAt ?? null,
          mailCleanupPending: input.mailCleanupPending ?? false
        }
      });
      return toImportMessageView(created);
    }
    if (input.expectedOutcome !== undefined && current.outcome !== input.expectedOutcome) {
      return toImportMessageView(current);
    }
    // Terminal content results are monotonic unless a caller explicitly
    // supplies the state it is transitioning from (for example, a manual
    // retry of INVALID). This prevents a late worker failure from replacing
    // a result already committed by another worker.
    const explicitTerminalTransition =
      isTerminalImportOutcome(current.outcome) &&
      input.expectedOutcome === current.outcome &&
      input.outcome !== current.outcome;
    if (isTerminalImportOutcome(current.outcome) &&
        input.outcome !== current.outcome &&
        !explicitTerminalTransition) {
      return toImportMessageView(current);
    }
    // Once Gmail cleanup has succeeded, a late callback for the same
    // terminal outcome must not re-open cleanup. Clearing a pending cleanup
    // remains allowed (and is guarded by expectedOutcome when supplied).
    if (isTerminalImportOutcome(current.outcome) &&
        current.outcome === input.outcome &&
        current.mailCleanupPending === false &&
        input.mailCleanupPending === true) {
      return toImportMessageView(current);
    }
    const updated = await tx.workInstructionImportMessage.update({
      where: { id: current.id },
      data: {
        outcome: input.outcome,
        error: input.error === undefined ? current.error : input.error,
        nextRetryAt: input.nextRetryAt === undefined ? current.nextRetryAt : input.nextRetryAt,
        mailCleanupPending: input.mailCleanupPending === undefined
          ? current.mailCleanupPending
          : input.mailCleanupPending
      }
    });
    return toImportMessageView(updated);
  });
}

export async function readWorkInstructionImportMessage(
  db: PrismaClient,
  gmailMessageId: string
): Promise<WorkInstructionImportMessageView | null> {
  const record = await db.workInstructionImportMessage.findUnique({ where: { gmailMessageId } });
  return record ? toImportMessageView(record) : null;
}

export async function readWorkInstructionImportMessages(
  db: PrismaClient,
  input: WorkInstructionImportMessagesQuery
): Promise<ReadonlyArray<WorkInstructionImportMessageView>> {
  assertPage(input);
  const ids = [...new Set(input.gmailMessageIds?.filter(Boolean) ?? [])];
  if (input.gmailMessageIds && ids.length === 0) return [];
  const and: Prisma.WorkInstructionImportMessageWhereInput[] = [];
  if (ids.length > 0) and.push({ gmailMessageId: { in: ids } });
  if (input.outcome) and.push({ outcome: input.outcome });
  if (input.mailCleanupPending !== undefined) and.push({ mailCleanupPending: input.mailCleanupPending });
  if (input.retryDueAt) {
    and.push({
      OR: [
        { outcome: 'PENDING' },
        { outcome: 'PROCESSING' },
        {
          outcome: 'RETRYABLE',
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: input.retryDueAt } }
          ]
        },
        {
          mailCleanupPending: true,
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: input.retryDueAt } }
          ]
        }
      ]
    });
  }
  const where: Prisma.WorkInstructionImportMessageWhereInput | undefined = and.length > 0 ? { AND: and } : undefined;
  const orderBy = input.retryDueAt
    ? [{ nextRetryAt: 'asc' as const }, { updatedAt: 'asc' as const }, { id: 'asc' as const }]
    : [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];
  const records = await db.workInstructionImportMessage.findMany({
    where,
    orderBy,
    skip: input.offset,
    take: input.limit
  });
  return records.map(toImportMessageView);
}
