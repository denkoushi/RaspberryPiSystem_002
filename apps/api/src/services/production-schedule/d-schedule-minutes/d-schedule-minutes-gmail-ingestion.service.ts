import { GmailSenderVerificationSession } from '../../gmail/gmail-sender-verification-session.js';
import { createHash, randomUUID } from 'node:crypto';

import { ApiError } from '../../../lib/errors.js';
import { MAX_XLSX_BYTES } from '../../assembly/check-sheet/check-sheet-import.constants.js';
import { logger } from '../../../lib/logger.js';
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
import { applyDScheduleMinutes, DScheduleMinutesComparisonError, type DScheduleMinutesRunMetadata } from './apply-d-schedule-minutes.service.js';
import { summarizeMinutes, type DScheduleMinutesMetrics, type DScheduleMinutesSummary } from './import-summary.js';

type GmailPort = Pick<GmailApiClient, 'searchMessagesLimited' | 'getMessage' | 'getAttachment' | 'trashMessage' | 'markAsRead'>;
export type DScheduleMinutesCycleSummary = DScheduleMinutesSummary & { processed: number; runs: Array<DScheduleMinutesSummary & { gmailMessageId: string; kind: DScheduleMinutesKind }> };

type ImportRun = Awaited<ReturnType<typeof applyDScheduleMinutes>>;
class InvalidMinutesError extends Error {}

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

  async listRecentRuns() {
    const runs = await this.deps.db.productionScheduleDScheduleMinutesImportRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
      select: {
        id: true, kind: true, filename: true, meetingDate: true, receivedAt: true,
        createdAt: true, status: true, originalFilePath: true,
      },
    });
    return runs.map(({ originalFilePath, ...run }) => ({ ...run, hasOriginalFile: Boolean(originalFilePath) }));
  }

  async reimportOriginal(id: string) {
    if (this.running) throw new ApiError(409, '日程会議議事録を取り込み中です');
    this.running = true;
    try {
      const original = await this.deps.db.productionScheduleDScheduleMinutesImportRun.findUnique({ where: { id } });
      if (!original) throw new ApiError(404, '取り込み履歴が見つかりません');
      const { originalFilePath, subject, filename, receivedAt } = original;
      if (!originalFilePath) throw new ApiError(404, '元のファイルが保存されていません');

      let buffer: Buffer;
      try {
        buffer = await getFileStorageRuntime().store.read(originalFilePath, { verifyIntegrity: true });
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new ApiError(404, '保存先に元のファイルが見つかりません');
        }
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, '保存済みのファイルを読み込めません');
      }

      const gmailMessageId = `reimport:${id}:${randomUUID()}`;
      const imported = await this.parseAndApply(buffer, { gmailMessageId, subject, filename, receivedAt, originalFilePath });
      if (!imported) throw new ApiError(422, '保存済みのファイルを日程会議議事録として読み取れません');
      const { kind, run } = imported;
      const { warnings, autoRegistrationSkipped } = await this.notifyAndSummarize(gmailMessageId, kind, run);
      const counts = new Map<string, number>();
      for (const { code } of warnings) counts.set(code, (counts.get(code) ?? 0) + 1);
      return { id: run.id, status: run.status, warningCounts: Object.fromEntries(counts), autoRegistrationSkipped };
    } catch (error) {
      if (error instanceof InvalidMinutesError || error instanceof DScheduleMinutesComparisonError) {
        throw new ApiError(422, error.message);
      }
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async parseAndApply(
    buffer: Buffer,
    metadata: Omit<DScheduleMinutesRunMetadata, 'kind'>,
    runs?: Map<DScheduleMinutesKind, ImportRun>,
  ) {
    const { filename, receivedAt, subject, gmailMessageId } = metadata;
    const parseInput = { buffer, filename, receivedAt, subject };
    let result = await this.deps.parse(parseInput);
    let kind: DScheduleMinutesKind = 'D_COMPANY';
    if (!result.ok) {
      const internal = await parseInternalScheduleMinutesXlsx(parseInput);
      if (internal.ok || !['MISSING_HEADERS', 'INVALID_XLSX'].includes(internal.reason)) {
        result = internal;
        kind = 'INTERNAL';
      }
    }
    if (!result.ok && ['MISSING_HEADERS', 'INVALID_XLSX'].includes(result.reason)) return;
    let run = runs?.get(kind) ?? await this.deps.db.productionScheduleDScheduleMinutesImportRun.findUnique({
      where: { gmailMessageId_kind: { gmailMessageId, kind } },
    });
    if (run?.status !== 'SUCCESS') {
      const originalFilePath = metadata.originalFilePath ?? await this.deps.saveOriginal(buffer);
      if (!Number.isFinite(receivedAt.getTime()) || receivedAt.getTime() <= 0) {
        throw new InvalidMinutesError('メールの受信日時を取得できません');
      }
      if (!result.ok) throw new InvalidMinutesError(`${minutesName(kind)}を読み取れません: ${result.reason}`);
      run = await this.deps.apply({ result, metadata: { ...metadata, kind, originalFilePath } });
    }
    return { run, kind };
  }

  private async notifyAndSummarize(gmailMessageId: string, kind: DScheduleMinutesKind, run: ImportRun) {
    const warnings = run.warnings as DScheduleMinutesWarning[];
    await this.deps.notify(gmailMessageId, warnings, kind);
    const registration = run.autoRegisteredSeibans as { metrics?: DScheduleMinutesMetrics; autoRegistrationSkipped?: 'STALE_FILE' };
    return summarizeMinutes(registration.metrics, warnings, registration.autoRegistrationSkipped);
  }

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
        const runs = new Map<DScheduleMinutesKind, ImportRun>();
        const contentFailures: string[] = [];
        const transientFailures: string[] = [];
        for (const attachment of collectGmailAttachments(message).filter((item) => /\.xlsx$/i.test(item.filename))) {
          try {
            if ((attachment.size ?? 0) > MAX_XLSX_BYTES) {
              logger.warn({ gmailMessageId, filename: attachment.filename, size: attachment.size }, 'Skipped oversized schedule minutes attachment');
              continue;
            }
            const buffer = await gmail.getAttachment(gmailMessageId, attachment.attachmentId);
            if (buffer.length > MAX_XLSX_BYTES) {
              logger.warn({ gmailMessageId, filename: attachment.filename, size: buffer.length }, 'Skipped oversized schedule minutes attachment');
              continue;
            }
            const imported = await this.parseAndApply(buffer, { gmailMessageId, filename: attachment.filename, receivedAt, subject }, runs);
            if (imported) runs.set(imported.kind, imported.run);
          } catch (error) {
            const failure = `${gmailMessageId}: ${error instanceof Error ? error.message : String(error)}`;
            if (error instanceof InvalidMinutesError || error instanceof DScheduleMinutesComparisonError) contentFailures.push(failure);
            else transientFailures.push(failure);
          }
        }
        permanentFailures.push(...contentFailures);
        failures.push(...transientFailures);
        // A transient failure must remain unread even if another attachment failed permanently.
        if (transientFailures.length > 0) continue;
        try {
          for (const [kind, run] of runs) {
            const result = await this.notifyAndSummarize(gmailMessageId, kind, run);
            summary.runs.push({ gmailMessageId, kind, ...result });
            for (const key of ['seibansRead', 'dateChanged', 'unchanged', 'autoRegistered', 'unregistered', 'skipped'] as const) summary[key] += result[key];
            summary.warnings.push(...result.warnings);
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
