import type { BackupConfig } from '../backup/backup-config.js';
import { ITEM_INVENTORY_GMAIL_SUBJECT_TOKENS } from '../gmail/gmail-subject-reservation.policy.js';

export const ITEM_INVENTORY_IMPORT_JOB_TYPE = 'ITEM_INVENTORY_GMAIL';
export const ITEM_INVENTORY_RETRY_DELAY_MS = 5 * 60 * 1000;
export const ITEM_INVENTORY_BATCH_LIMIT = 20;

export type ItemInventoryGmailIngestConfig = NonNullable<BackupConfig['itemInventoryGmailIngest']>;

export function escapeGmailQuotedSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildItemInventoryGmailSearchQuery(
  config: Pick<ItemInventoryGmailIngestConfig, 'subjectTokens' | 'fromEmail'>
): string {
  const allowed = new Set<string>(ITEM_INVENTORY_GMAIL_SUBJECT_TOKENS);
  const tokens = config.subjectTokens.filter((token) => allowed.has(token));
  const effective = tokens.length > 0 ? tokens : [...ITEM_INVENTORY_GMAIL_SUBJECT_TOKENS];
  const subject = effective.map((token) => `subject:"${escapeGmailQuotedSearchValue(token)}"`).join(' OR ');
  const clauses = [`(${subject})`, 'in:inbox', 'is:unread'];
  if (config.fromEmail?.trim()) clauses.push(`from:${config.fromEmail.trim()}`);
  return clauses.join(' ');
}

export function extractEmail(from: string | undefined): string | undefined {
  if (!from) return undefined;
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLocaleLowerCase('en-US');
}
