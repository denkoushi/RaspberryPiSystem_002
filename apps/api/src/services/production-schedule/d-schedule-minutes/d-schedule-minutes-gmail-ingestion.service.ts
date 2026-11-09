import { GmailSenderVerificationSession } from '../../gmail/gmail-sender-verification-session.js';
import { createHash } from 'node:crypto';

import { prisma } from '../../../lib/prisma.js';
import type { BackupConfig } from '../../backup/backup-config.js';
import { collectGmailAttachments, type GmailApiClient } from '../../backup/gmail-api-client.js';
import { resolveGmailApiClientFromBackupConfig } from '../../gmail/gmail-api-client.factory.js';
import { ASSEMBLY_PROCEDURE_GMAIL_SUBJECT, MACHINE_SIGNAL_GMAIL_SUBJECT, isWorkInstructionGmailSubject, isItemInventoryGmailSubject, isProcedureMaterialGmailSubject } from '../../gmail/gmail-subject-reservation.policy.js';
import { getFileStorageRuntime } from '../../file-storage/file-storage-runtime.js';
import { FileStorageAlreadyExistsError } from '../../file-storage/file-storage-errors.js';
import { deliverDScheduleMinutesNotice } from '../../kiosk-inquiry/system-notice-sources.js';
import { parseDScheduleMinutesXlsx, type DScheduleMinutesWarning } from './parse-d-schedule-minutes.js';
import { parseInternalScheduleMinutesXlsx } from './parse-internal-schedule-minutes.js';
import { minutesName, type DScheduleMinutesKind } from './minutes-kind.js';
import { applyDScheduleMinutes, DScheduleMinutesComparisonError } from './apply-d-schedule-minutes.service.js';
import { summarizeMinutes, type DScheduleMinutesMetrics, type DScheduleMinutesSummary } from './import-summary.js';

type GmailPort = Pick<GmailApiClient, 'searchMessagesLimited' | 'getMessage' | 'getAttachment' | 'trashMessage' | 'markAsRead'>;
export type DScheduleMinutesCycleSummary = DScheduleMinutesSummary & { processed: number; runs: Array<DScheduleMinutesSummary & { gmailMessageId: string; kind: DScheduleMinutesKind }> };

export class DScheduleMinutesContentError extends Error {
  constructor(readonly permanentFailures: string[], readonly retryableFailures: string[] = []) {
    super(`D社日程会議議事録の取込に失敗しました: ${[...retryableFailures, ...permanentFailures].join('; ')}`);
  }
}

export async function saveDScheduleMinutesOriginal(buffer: Buffer): Promise<string> {
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const key = `csv-dashboards/d-schedule-minutes/${sha256}.xlsx`;
  const store = getFileStorageRuntime().store;
  await store.initialize(['csv-dashboards/d-schedule-minutes']);
  try {
    await store.write({ key, data: buffer, mode: 'create', integrity: true });
  } catch (error) {
    if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
    const existing = await store.read(key, { verifyIntegrity: true });
    if (createHash('sha256').update(existing).digest('hex') !== sha256) throw error;
  }
  return key;
}

export class DScheduleMinutesGmailIngestionService {
  private running = false;
  constructor(private readonly deps = {
    gmailFactory: resolveGmailApiClientFromBackupConfig as (config: BackupConfig, options: { allowWait: boolean }) => Promise<GmailPort>,
    db: prisma,
    saveOriginal: saveDScheduleMinutesOriginal,
    parse: parseDScheduleMinutesXlsx,
    apply: applyDScheduleMinutes,
    notify: deliverDScheduleMinutesNotice,
  }) {}

  async runOnce(options: { config: BackupConfig; allowWait: boolean }): Promise<DScheduleMinutesCycleSummary> {
    const summary: DScheduleMinutesCycleSummary = { ...summarizeMinutes(undefined, []), processed: 0, runs: [] };
    if (this.running) return summary;
    this.running = true;
    const senderSession = GmailSenderVerificationSession.forRun(options.config);
    try {
      if (senderSession.disabled) return summary;
      const gmail = senderSession.wrap(await this.deps.gmailFactory({ ...options.config, storage: { ...options.config.storage, provider: 'gmail' } }, { allowWait: options.allowWait }));
      const fromEmail = options.config.storage.options?.gmail?.fromEmail ?? options.config.storage.options?.fromEmail;
      const label = (process.env.GMAIL_TRASH_CLEANUP_LABEL || 'rps_processed').trim();
      const query = `in:inbox is:unread -label:${label} filename:xlsx newer_than:60d${fromEmail ? ` from:${fromEmail}` : ''}`;
      const ids = await gmail.searchMessagesLimited(query, 10);
      const failures: string[] = [];
      const permanentFailures: string[] = [];
      const candidates = [];
      for (const gmailMessageId of await senderSession.filterMessageIds(gmail, ids)) {
        try {
          candidates.push({ gmailMessageId, message: await gmail.getMessage(gmailMessageId) });
        } catch (error) {
          failures.push(`${gmailMessageId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      candidates.sort((a, b) => a.message.internalDateMs - b.message.internalDateMs);
      for (const { gmailMessageId, message } of candidates) {
        const subject = message.payload?.headers?.find((header) => header.name.toLowerCase() === 'subject')?.value ?? '';
        if (isWorkInstructionGmailSubject(subject) || isItemInventoryGmailSubject(subject)
          || isProcedureMaterialGmailSubject(subject) || subject.includes(ASSEMBLY_PROCEDURE_GMAIL_SUBJECT)
          || subject.includes(MACHINE_SIGNAL_GMAIL_SUBJECT)) continue;
        const receivedAt = new Date(message.internalDateMs);
        const runs = new Map<DScheduleMinutesKind, Awaited<ReturnType<typeof applyDScheduleMinutes>>>();
        const contentFailures: string[] = [];
        const transientFailures: string[] = [];
        for (const attachment of collectGmailAttachments(message).filter((item) => /\.xlsx$/i.test(item.filename))) {
          let permanentContentFailure = false;
          try {
            const buffer = await gmail.getAttachment(gmailMessageId, attachment.attachmentId);
            const parseInput = { buffer, filename: attachment.filename, receivedAt, subject };
            let result = await this.deps.parse(parseInput);
            let kind: DScheduleMinutesKind = 'D_COMPANY';
            if (!result.ok) {
              const internal = await parseInternalScheduleMinutesXlsx(parseInput);
              if (internal.ok || !['MISSING_HEADERS', 'INVALID_XLSX'].includes(internal.reason)) {
                result = internal;
                kind = 'INTERNAL';
              }
            }
            if (!result.ok && ['MISSING_HEADERS', 'INVALID_XLSX'].includes(result.reason)) continue;
            let run = runs.get(kind) ?? await this.deps.db.productionScheduleDScheduleMinutesImportRun.findUnique({
              where: { gmailMessageId_kind: { gmailMessageId, kind } }
            });
            if (run?.status !== 'SUCCESS') {
              const originalFilePath = await this.deps.saveOriginal(buffer);
              if (!Number.isFinite(receivedAt.getTime()) || message.internalDateMs <= 0) {
                permanentContentFailure = true;
                throw new Error('メールの受信日時を取得できません');
              }
              if (!result.ok) {
                permanentContentFailure = true;
                throw new Error(`${minutesName(kind)}を読み取れません: ${result.reason}`);
              }
              run = await this.deps.apply({ result, metadata: { gmailMessageId, kind, subject, filename: attachment.filename, receivedAt, originalFilePath } });
            }
            runs.set(kind, run);
          } catch (error) {
            const failure = `${gmailMessageId}: ${error instanceof Error ? error.message : String(error)}`;
            if (permanentContentFailure || error instanceof DScheduleMinutesComparisonError) contentFailures.push(failure);
            else transientFailures.push(failure);
          }
        }
        permanentFailures.push(...contentFailures);
        failures.push(...transientFailures);
        // A transient failure must remain unread even if another attachment failed permanently.
        if (transientFailures.length > 0) continue;
        try {
          for (const [kind, run] of runs) {
            const warnings = run.warnings as DScheduleMinutesWarning[];
            await this.deps.notify(gmailMessageId, warnings, kind);
            const registration = run.autoRegisteredSeibans as { metrics?: DScheduleMinutesMetrics; autoRegistrationSkipped?: 'STALE_FILE' };
            const result = summarizeMinutes(registration.metrics, warnings, registration.autoRegistrationSkipped);
            summary.runs.push({ gmailMessageId, kind, ...result });
            for (const key of ['seibansRead', 'dateChanged', 'unchanged', 'autoRegistered', 'unregistered', 'skipped'] as const) summary[key] += result[key];
            summary.warnings.push(...warnings);
            summary.processed += 1;
          }
          // Preserve content failures; unrelated mail remains untouched.
          if (contentFailures.length > 0) await gmail.markAsRead(gmailMessageId);
          else if (runs.size > 0) {
            await gmail.trashMessage(gmailMessageId);
            await gmail.markAsRead(gmailMessageId);
          }
        } catch (error) {
          failures.push(`${gmailMessageId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (permanentFailures.length > 0) throw new DScheduleMinutesContentError(permanentFailures, failures);
      if (failures.length > 0) throw new Error(`D社日程会議議事録の取込に失敗しました: ${failures.join('; ')}`);
      return summary;
    } finally {
      this.running = false;
      await senderSession.notify();
    }
  }
}
let instance: DScheduleMinutesGmailIngestionService | undefined;
export function getDScheduleMinutesGmailIngestionService(): DScheduleMinutesGmailIngestionService {
  return instance ??= new DScheduleMinutesGmailIngestionService();
}
