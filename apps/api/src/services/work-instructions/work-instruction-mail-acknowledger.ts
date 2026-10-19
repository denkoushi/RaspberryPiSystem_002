import { logger } from '../../lib/logger.js';
import type { WorkInstructionImportOutcome } from './domain/types.js';
import type { WorkInstructionRepository } from './repositories/work-instruction-repository.port.js';
import type { WorkInstructionGmailPort } from './work-instruction-gmail.port.js';
import { WORK_INSTRUCTION_RETRY_DELAY_MS } from './work-instruction-ingestion.policy.js';

export type WorkInstructionAcknowledgementResult = {
  outcome: WorkInstructionImportOutcome;
  acknowledged?: boolean;
  acknowledgementPending?: boolean;
  error?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A terminal database result is durable before Gmail is mutated. This keeps
 * acknowledgement retries cleanup-only after a process interruption.
 */
export async function acknowledgeWorkInstructionMessage(input: {
  repository: WorkInstructionRepository;
  gmail: WorkInstructionGmailPort;
  messageId: string;
  outcome: WorkInstructionImportOutcome;
  error?: string | null;
}): Promise<WorkInstructionAcknowledgementResult> {
  const pendingError = input.error ?? null;
  await input.repository.recordImportMessage({
    gmailMessageId: input.messageId,
    outcome: input.outcome,
    error: pendingError,
    nextRetryAt: new Date(Date.now() + WORK_INSTRUCTION_RETRY_DELAY_MS),
    mailCleanupPending: true,
  });

  try {
    let messageGone = false;
    try {
      await input.gmail.markAsRead(input.messageId);
    } catch (markError) {
      if (!isGmailMessageGone(markError)) throw markError;
      messageGone = true;
    }
    if (!messageGone) {
      try {
        await input.gmail.trashMessage(input.messageId);
      } catch (trashError) {
        if (!isGmailMessageGone(trashError)) throw trashError;
      }
    }
    await input.repository.recordImportMessage({
      gmailMessageId: input.messageId,
      outcome: input.outcome,
      error: pendingError,
      nextRetryAt: null,
      mailCleanupPending: false,
    });
    return { outcome: input.outcome, acknowledged: true };
  } catch (ackError) {
    const ackReason = pendingError
      ? `${pendingError}; mail cleanup: ${errorMessage(ackError)}`
      : `mail cleanup: ${errorMessage(ackError)}`;
    try {
      await input.repository.recordImportMessage({
        gmailMessageId: input.messageId,
        outcome: input.outcome,
        error: ackReason,
        nextRetryAt: new Date(Date.now() + WORK_INSTRUCTION_RETRY_DELAY_MS),
        mailCleanupPending: true,
      });
    } catch (recordError) {
      logger.error(
        { err: recordError, messageId: input.messageId },
        '[WorkInstructionGmailIngestion] failed to record pending mail cleanup'
      );
    }
    return { outcome: input.outcome, acknowledgementPending: true, error: ackReason };
  }
}

function isGmailMessageGone(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const candidate = current as {
        status?: unknown;
        code?: unknown;
        cause?: unknown;
        response?: { status?: unknown; statusCode?: unknown };
      };
      const status = candidate.status ?? candidate.code ?? candidate.response?.status ?? candidate.response?.statusCode;
      if (status === 404 || status === '404') {
        return true;
      }
      current = candidate.cause;
      continue;
    }
    break;
  }
  return false;
}
