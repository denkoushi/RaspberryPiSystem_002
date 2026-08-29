import type { BackupConfig } from '../backup/backup-config.js';
import { WORK_INSTRUCTION_GMAIL_SUBJECT_TOKENS } from '../gmail/gmail-subject-reservation.policy.js';
import type { WorkInstructionImportMessageView, WorkInstructionImportOutcome } from './domain/types.js';

export const WORK_INSTRUCTION_IMPORT_JOB_TYPE = 'WORK_INSTRUCTION_GMAIL';
export const WORK_INSTRUCTION_POLL_INTERVAL_MINUTES = 5;
export const WORK_INSTRUCTION_BATCH_LIMIT = 20;
export const WORK_INSTRUCTION_NEW_RESERVATION = 10;
export const WORK_INSTRUCTION_RETRY_DELAY_MS = 5 * 60 * 1000;

export type WorkInstructionGmailIngestConfig = NonNullable<BackupConfig['workInstructionGmailIngest']>;

export function escapeGmailQuotedSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Reserve ten new and ten due-retry slots, then reuse unused slots from the
 * other queue. IDs are de-duplicated before allocation.
 */
export function allocateWorkInstructionBatch(
  newMessageIds: ReadonlyArray<string>,
  retryMessageIds: ReadonlyArray<string>,
  limit = WORK_INSTRUCTION_BATCH_LIMIT
): { newIds: string[]; retryIds: string[] } {
  const unique = (ids: ReadonlyArray<string>): string[] => Array.from(new Set(ids));
  const fresh = unique(newMessageIds);
  const retry = unique(retryMessageIds).filter((id) => !fresh.includes(id));
  const newReservation = Math.min(WORK_INSTRUCTION_NEW_RESERVATION, limit, fresh.length);
  const retryReservation = Math.min(
    WORK_INSTRUCTION_NEW_RESERVATION,
    Math.max(0, limit - newReservation),
    retry.length
  );
  const newIds = fresh.slice(0, newReservation);
  const retryIds = retry.slice(0, retryReservation);
  let remaining = Math.max(0, limit - newIds.length - retryIds.length);
  if (remaining > 0) {
    const extraRetry = retry.slice(retryIds.length, retryIds.length + remaining);
    retryIds.push(...extraRetry);
    remaining -= extraRetry.length;
  }
  if (remaining > 0) {
    const extraNew = fresh.slice(newIds.length, newIds.length + remaining);
    newIds.push(...extraNew);
  }
  return { newIds, retryIds };
}

export function buildWorkInstructionGmailSearchQuery(
  config: Pick<WorkInstructionGmailIngestConfig, 'subjectTokens' | 'fromEmail'>
): string {
  const allowedTokens = new Set<string>(WORK_INSTRUCTION_GMAIL_SUBJECT_TOKENS);
  const tokens = config.subjectTokens.filter((token) => allowedTokens.has(token));
  const effectiveTokens = tokens.length > 0 ? tokens : [...WORK_INSTRUCTION_GMAIL_SUBJECT_TOKENS];
  const subjectQuery = effectiveTokens
    .map((token) => `subject:"${escapeGmailQuotedSearchValue(token)}"`)
    .join(' OR ');
  const clauses = [`(${subjectQuery})`];
  if (config.fromEmail?.trim()) clauses.push(`from:${config.fromEmail.trim()}`);
  // Fresh intake is limited to the current inbox. Retries and acknowledgement
  // recovery are selected from the import-message table independently.
  clauses.push('in:inbox', 'is:unread');
  return clauses.join(' ');
}

export function isTerminalOutcome(outcome: WorkInstructionImportOutcome): boolean {
  return ['APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT', 'INVALID'].includes(outcome);
}

export function isDueRetry(record: WorkInstructionImportMessageView, now: Date): boolean {
  if (record.mailCleanupPending) return false;
  if (record.outcome === 'PENDING' || record.outcome === 'PROCESSING') return true;
  return record.outcome === 'RETRYABLE' &&
    (!record.nextRetryAt || record.nextRetryAt.getTime() <= now.getTime());
}

export function extractEmail(from: string | undefined): string | undefined {
  if (!from) return undefined;
  const bracketed = from.match(/<([^>]+)>/);
  return (bracketed?.[1] ?? from).trim().toLowerCase();
}
