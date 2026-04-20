import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { emitDebugEvent } from '../../lib/debug-sink.js';
import { CsvDashboardIngestor } from './csv-dashboard-ingestor.js';
import { CsvDashboardStorage } from '../../lib/csv-dashboard-storage.js';
import { CsvDashboardSourceService } from './csv-dashboard-source.service.js';
import { NoMatchingMessageError } from '../backup/storage/gmail-storage.provider.js';
import { MeasuringInstrumentLoanEventService } from '../measuring-instruments/measuring-instrument-loan-event.service.js';
import { PrismaCsvImportSubjectPatternProvider } from '../imports/csv-import-subject-pattern.provider.js';
import { GmailUnifiedMailboxFetcher } from '../backup/gmail-unified-mailbox-fetcher.js';
import { CsvErrorDispositionPolicy } from './csv-error-disposition-policy.js';
import { CsvDashboardPostIngestService } from './csv-dashboard-post-ingest.service.js';
import {
  ensureProductionScheduleSeibanMachineNameSupplementDashboard,
} from '../production-schedule/seiban-machine-name-supplement-dashboard.definition.js';
import { ensureProductionScheduleFkobainoDashboard } from '../production-schedule/fkobaino-dashboard.definition.js';
import {
  PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from '../production-schedule/constants.js';

export type CsvDashboardIngestResult = {
  rowsProcessed: number;
  rowsAdded: number;
  rowsSkipped: number;
  debug?: {
    provider: string;
    bufferResultsCount: number;
    downloadedMessageIdSuffixes: string[];
    postProcessedMessageIdSuffixes: string[];
    failedMessageIdSuffixes: string[];
    postProcessErrorByMessageIdSuffix?: Record<string, { step: 'markAsRead' | 'trashMessage'; error: string }>;
    disposedMessageIdSuffixes?: string[];
    disposeReasonByMessageIdSuffix?: Record<string, string>;
    postProcessStateByMessageIdSuffix?: Record<string, 'completed' | 'disposed_non_retriable' | 'failed'>;
    canPostProcessGmail: boolean;
    // #region agent debug: ステップ追跡用
    stepLogs: string[];
    errorDetails: Array<{ messageIdSuffix: string; step: string; error: string }>;
    // #endregion
  };
};

export class CsvDashboardImportService {
  private sourceService = new CsvDashboardSourceService();
  private ingestor = new CsvDashboardIngestor();
  private measuringInstrumentLoanEventService = new MeasuringInstrumentLoanEventService();
  private subjectPatternProvider = new PrismaCsvImportSubjectPatternProvider();
  private unifiedMailboxFetcher = new GmailUnifiedMailboxFetcher();
  private errorDispositionPolicy = new CsvErrorDispositionPolicy();
  private postIngestService = new CsvDashboardPostIngestService();

  private static readonly MEASURING_INSTRUMENT_LOANS_DASHBOARD_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  private static readonly INGEST_AUDIT_PREFIX = '[ingest-audit]';

  private static canFetchUnifiedMailbox(
    storageProvider: StorageProvider
  ): storageProvider is StorageProvider & {
    downloadAllBySubjectPatterns: (
      subjectPatterns: string[]
    ) => Promise<Record<string, Array<{ buffer: Buffer; messageId: string; messageSubject: string }>>>;
  } {
    return typeof (storageProvider as { downloadAllBySubjectPatterns?: unknown }).downloadAllBySubjectPatterns === 'function';
  }

  private static canPostProcessGmail(storageProvider: StorageProvider): storageProvider is StorageProvider & {
    markAsRead: (messageId: string) => Promise<void>;
    trashMessage: (messageId: string) => Promise<void>;
  } {
    const provider = storageProvider as StorageProvider & {
      markAsRead?: (messageId: string) => Promise<void>;
      trashMessage?: (messageId: string) => Promise<void>;
    };
    return typeof provider.markAsRead === 'function' && typeof provider.trashMessage === 'function';
  }

  private async resolveSubjectPatterns(dashboardId: string, legacyPattern?: string): Promise<string[]> {
    const patterns = await this.subjectPatternProvider.listEnabledPatterns({
      importType: 'csvDashboards',
      dashboardId,
    });
    const candidates = patterns.filter((p) => p.trim().length > 0);
    const legacy = legacyPattern?.trim();
    if (legacy && !candidates.includes(legacy)) {
      candidates.push(legacy);
    }
    return candidates;
  }

  private async appendIngestRunAudit(params: {
    dashboardId: string;
    messageId?: string;
    postProcessState: 'completed' | 'disposed_non_retriable' | 'failed';
    reason?: string;
  }): Promise<void> {
    if (!params.messageId) return;
    const latestRun = await prisma.csvDashboardIngestRun.findFirst({
      where: {
        csvDashboardId: params.dashboardId,
        messageId: params.messageId,
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, errorMessage: true },
    });
    if (!latestRun) return;
    const nextMessage = CsvDashboardImportService.mergeAuditMessage({
      currentErrorMessage: latestRun.errorMessage,
      postProcessState: params.postProcessState,
      reason: params.reason,
    });
    await prisma.csvDashboardIngestRun.update({
      where: { id: latestRun.id },
      data: { errorMessage: nextMessage },
    });
  }

  private async ensureFixedDashboardIfNeeded(dashboardId: string): Promise<void> {
    if (dashboardId === PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID) {
      await ensureProductionScheduleSeibanMachineNameSupplementDashboard(prisma);
      return;
    }

    if (dashboardId === PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID) {
      await ensureProductionScheduleFkobainoDashboard(prisma);
      // #region agent log
      fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4605d2'},body:JSON.stringify({sessionId:'4605d2',runId:'post-fix',hypothesisId:'H5',location:'csv-dashboard-import.service.ts:126',message:'ensured fixed FKOBAINO dashboard definition',data:{dashboardId},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
  }

  private static mergeAuditMessage(params: {
    currentErrorMessage: string | null;
    postProcessState: 'completed' | 'disposed_non_retriable' | 'failed';
    reason?: string;
  }): string {
    const auditLine = `${CsvDashboardImportService.INGEST_AUDIT_PREFIX} postProcessState=${params.postProcessState}${
      params.reason ? ` reason=${params.reason}` : ''
    }`;
    const current = params.currentErrorMessage?.trim();
    if (!current) return auditLine;
    const lines = current
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith(CsvDashboardImportService.INGEST_AUDIT_PREFIX));
    lines.push(auditLine);
    return lines.join('\n');
  }

  /**
   * csvDashboardsターゲット群を取り込み、dashboardId -> 結果 を返す。
   * - ダッシュボード不存在/無効/gmailSubjectPattern未設定は安全側でスキップ（ログのみ）
   */
  async ingestTargets(params: {
    provider: string;
    storageProvider: StorageProvider;
    dashboardIds: string[];
  }): Promise<Record<string, CsvDashboardIngestResult>> {
    const { provider, storageProvider, dashboardIds } = params;
    const results: Record<string, CsvDashboardIngestResult> = {};

    const dashboardSubjects = new Map<string, string[]>();
    const unifiedPatternSet = new Set<string>();
    for (const dashboardId of dashboardIds) {
      await this.ensureFixedDashboardIfNeeded(dashboardId);
      const dashboard = await prisma.csvDashboard.findUnique({ where: { id: dashboardId } });
      if (!dashboard || !dashboard.enabled) {
        continue;
      }
      const legacyPattern = (dashboard as unknown as { gmailSubjectPattern?: string | null }).gmailSubjectPattern;
      const subjectPatterns = await this.resolveSubjectPatterns(dashboardId, legacyPattern ?? undefined);
      dashboardSubjects.set(dashboardId, subjectPatterns);
      subjectPatterns.forEach((pattern) => unifiedPatternSet.add(pattern));
    }

    const unifiedResultsByPattern: Record<
      string,
      Array<{ buffer: Buffer; messageId: string; messageSubject: string }>
    > = {};
    if (
      provider === 'gmail' &&
      CsvDashboardImportService.canFetchUnifiedMailbox(storageProvider) &&
      unifiedPatternSet.size > 0
    ) {
      try {
        Object.assign(
          unifiedResultsByPattern,
          await this.unifiedMailboxFetcher.fetchBySubjectPatterns(storageProvider, Array.from(unifiedPatternSet))
        );
      } catch (error) {
        if (!(error instanceof NoMatchingMessageError)) {
          throw error;
        }
      }
    }

    for (const dashboardId of dashboardIds) {
      // #region agent log
      void emitDebugEvent({ sessionId: 'debug-session', runId: 'verify-step1', hypothesisId: 'A', location: 'csv-dashboard-import.service.ts:dashboard-loop', message: 'Start dashboard ingest loop', data: { dashboardId, provider } });
      // #endregion
      const dashboard = await prisma.csvDashboard.findUnique({ where: { id: dashboardId } });

      if (!dashboard) {
        logger?.warn({ dashboardId }, '[CsvDashboardImportService] CSV dashboard not found, skipping');
        continue;
      }

      if (!dashboard.enabled) {
        logger?.warn({ dashboardId }, '[CsvDashboardImportService] CSV dashboard is disabled, skipping');
        continue;
      }

      const subjectPatterns = dashboardSubjects.get(dashboardId) ?? [];
      // #region agent log
      fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4605d2'},body:JSON.stringify({sessionId:'4605d2',runId:'gmail-manual-run',hypothesisId:'H2',location:'csv-dashboard-import.service.ts:204',message:'dashboard subject patterns resolved',data:{dashboardId,provider,subjectPatternCount:subjectPatterns.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (subjectPatterns.length === 0) {
        logger?.warn(
          { dashboardId, provider },
          '[CsvDashboardImportService] CSV dashboard subject pattern is not set, skipping'
        );
        continue;
      }

      logger?.info(
        { dashboardId, subjectPatterns, provider },
        '[CsvDashboardImportService] Processing CSV dashboard ingestion'
      );

      const bufferResults: Array<{ buffer: Buffer; messageId?: string; messageSubject?: string }> = [];
      if (provider === 'gmail' && Object.keys(unifiedResultsByPattern).length > 0) {
        for (const pattern of subjectPatterns) {
          const unifiedResults = unifiedResultsByPattern[pattern] ?? [];
          bufferResults.push(...unifiedResults);
        }
      } else {
        for (const pattern of subjectPatterns) {
          try {
            const results = await this.sourceService.downloadCsv({
              provider,
              storageProvider,
              gmailSubjectPattern: pattern,
            });
            bufferResults.push(...results);
          } catch (error) {
            if (error instanceof NoMatchingMessageError) {
              logger?.info(
                { dashboardId, subjectPattern: pattern, provider },
                '[CsvDashboardImportService] No matching Gmail message, trying next pattern'
              );
              continue;
            }
            throw error;
          }
        }
      }

      if (bufferResults.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4605d2'},body:JSON.stringify({sessionId:'4605d2',runId:'gmail-manual-run',hypothesisId:'H1',location:'csv-dashboard-import.service.ts:246',message:'no matching messages for dashboard',data:{dashboardId,provider,subjectPatterns},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        logger?.info(
          { dashboardId, subjectPatterns, provider },
          '[CsvDashboardImportService] No matching Gmail message, skipping'
        );
        continue;
      }

      // #region agent log
      void emitDebugEvent({ sessionId: 'debug-session', runId: 'verify-step1', hypothesisId: 'A', location: 'csv-dashboard-import.service.ts:after-downloadCsv', message: 'downloadCsv returned results', data: { dashboardId, provider, resultsCount: bufferResults.length, canPostProcessGmail: (provider === 'gmail' && CsvDashboardImportService.canPostProcessGmail(storageProvider)) } });
      // #endregion

      let totalProcessed = 0;
      let totalAdded = 0;
      let totalSkipped = 0;
      let lastError: unknown | null = null;
      const downloadedMessageIdSuffixes: string[] = [];
      const postProcessedMessageIdSuffixes: string[] = [];
      const disposedMessageIdSuffixes: string[] = [];
      const failedMessageIdSuffixes: string[] = [];
      const postProcessStateByMessageIdSuffix: Record<
        string,
        'completed' | 'disposed_non_retriable' | 'failed'
      > = {};
      const postProcessErrorByMessageIdSuffix: Record<
        string,
        { step: 'markAsRead' | 'trashMessage'; error: string }
      > = {};
      const disposeReasonByMessageIdSuffix: Record<string, string> = {};
      const canPostProcessGmail = provider === 'gmail' && CsvDashboardImportService.canPostProcessGmail(storageProvider);
      // #region agent debug
      const stepLogs: string[] = [];
      const errorDetails: Array<{ messageIdSuffix: string; step: string; error: string }> = [];
      stepLogs.push(`init:canPostProcessGmail=${canPostProcessGmail}`);
      // #endregion

      for (const bufferResult of bufferResults) {
        const { buffer, messageId, messageSubject } = bufferResult;
        const safeMessageId = messageId ? messageId.slice(-6) : null;
        if (safeMessageId) downloadedMessageIdSuffixes.push(safeMessageId);
        // #region agent log
        void emitDebugEvent({ sessionId: 'debug-session', runId: 'verify-step1', hypothesisId: 'D', location: 'csv-dashboard-import.service.ts:per-message', message: 'Start processing message', data: { dashboardId, provider, messageIdSuffix: safeMessageId, hasMessageId: !!messageId, hasMessageSubject: !!messageSubject } });
        // #endregion
        const csvContent = buffer.toString('utf-8');

        try {
          // #region agent debug
          stepLogs.push(`${safeMessageId}:start`);
          // #endregion

          // CSVファイルを原本として保存
          const csvFilePath = await CsvDashboardStorage.saveRawCsv(dashboardId, buffer, messageId);
          // #region agent debug
          stepLogs.push(`${safeMessageId}:after-saveRawCsv`);
          // #endregion

          // 取り込み処理を実行
          const result = await this.ingestor.ingestFromGmail(
            dashboardId,
            csvContent,
            messageId,
            messageSubject,
            csvFilePath
          );

          await this.postIngestService.runAfterSuccessfulIngest({
            dashboardId,
            ingestSource: 'gmail',
            ingestRunId: result.ingestRunId,
          });
          // #region agent debug
          stepLogs.push(`${safeMessageId}:after-ingestFromGmail:${result.rowsProcessed}`);
          // #endregion

          totalProcessed += result.rowsProcessed;
          totalAdded += result.rowsAdded;
          totalSkipped += result.rowsSkipped;

          // 計測機器持出返却のイベント投影
          if (dashboardId === CsvDashboardImportService.MEASURING_INSTRUMENT_LOANS_DASHBOARD_ID) {
            // #region agent debug
            stepLogs.push(`${safeMessageId}:before-projectEvents`);
            // #endregion
            await this.measuringInstrumentLoanEventService.projectEventsFromCsv({
              dashboardId,
              csvContent,
              messageId,
              messageSubject,
            });
            // #region agent debug
            stepLogs.push(`${safeMessageId}:after-projectEvents`);
            // #endregion
          }

          // Gmail後処理（成功時のみ）
          // #region agent debug
          stepLogs.push(`${safeMessageId}:check-postProcess:provider=${provider},hasMessageId=${!!messageId},canPostProcess=${CsvDashboardImportService.canPostProcessGmail(storageProvider)}`);
          // #endregion
          const shouldPostProcess = provider === 'gmail' && !!messageId && CsvDashboardImportService.canPostProcessGmail(storageProvider);
          // #region agent log
          fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4605d2'},body:JSON.stringify({sessionId:'4605d2',runId:'gmail-manual-run',hypothesisId:'H3',location:'csv-dashboard-import.service.ts:345',message:'gmail post-process gate evaluated',data:{dashboardId,provider,hasMessageId:!!messageId,shouldPostProcess,messageIdSuffix:safeMessageId},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          // #region agent log
          void emitDebugEvent({ sessionId: 'debug-session', runId: 'gmail-inbox-not-clearing', hypothesisId: 'A', location: 'csv-dashboard-import.service.ts:postProcess-decision', message: 'Decide whether to post-process Gmail message', data: { provider, shouldPostProcess, messageIdSuffix: safeMessageId } });
          // #endregion
          if (shouldPostProcess && messageId) {
            // #region agent debug
            stepLogs.push(`${safeMessageId}:enter-postProcess`);
            // #endregion

            try {
              // #region agent debug
              stepLogs.push(`${safeMessageId}:before-markAsRead`);
              // #endregion
              await storageProvider.markAsRead(messageId);
              // #region agent debug
              stepLogs.push(`${safeMessageId}:after-markAsRead:success`);
              // #endregion
            } catch (postProcessError) {
              // #region agent debug
              const errMsg = postProcessError instanceof Error ? postProcessError.message : String(postProcessError);
              stepLogs.push(`${safeMessageId}:markAsRead-error:${errMsg.slice(0, 100)}`);
              errorDetails.push({ messageIdSuffix: safeMessageId || 'unknown', step: 'markAsRead', error: errMsg });
              // #endregion
              if (safeMessageId) {
                postProcessErrorByMessageIdSuffix[safeMessageId] = {
                  step: 'markAsRead',
                  error:
                    postProcessError instanceof Error ? postProcessError.message : String(postProcessError),
                };
              }
              // 後処理に失敗した場合は、メールを残して次回再試行できるようにする
              throw postProcessError;
            }

            try {
              // #region agent debug
              stepLogs.push(`${safeMessageId}:before-trashMessage`);
              // #endregion
              await storageProvider.trashMessage(messageId);
              // #region agent debug
              stepLogs.push(`${safeMessageId}:after-trashMessage:success`);
              // #endregion
              // #region agent log
              void emitDebugEvent({ sessionId: 'debug-session', runId: 'gmail-inbox-not-clearing', hypothesisId: 'B', location: 'csv-dashboard-import.service.ts:after-trashMessage', message: 'Gmail post-process completed', data: { messageIdSuffix: safeMessageId } });
              // #endregion
            } catch (postProcessError) {
              // #region agent debug
              const errMsg = postProcessError instanceof Error ? postProcessError.message : String(postProcessError);
              stepLogs.push(`${safeMessageId}:trashMessage-error:${errMsg.slice(0, 100)}`);
              errorDetails.push({ messageIdSuffix: safeMessageId || 'unknown', step: 'trashMessage', error: errMsg });
              // #endregion
              if (safeMessageId) {
                postProcessErrorByMessageIdSuffix[safeMessageId] = {
                  step: 'trashMessage',
                  error:
                    postProcessError instanceof Error ? postProcessError.message : String(postProcessError),
                };
              }
              // 後処理に失敗した場合は、メールを残して次回再試行できるようにする
              throw postProcessError;
            }

            // #region agent debug
            stepLogs.push(`${safeMessageId}:postProcess-complete`);
            // #endregion
            if (safeMessageId) postProcessedMessageIdSuffixes.push(safeMessageId);
            if (safeMessageId) postProcessStateByMessageIdSuffix[safeMessageId] = 'completed';
            await this.appendIngestRunAudit({
              dashboardId,
              messageId,
              postProcessState: 'completed',
            });
          }
        } catch (error) {
          // #region agent log
          fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4605d2'},body:JSON.stringify({sessionId:'4605d2',runId:'gmail-manual-run',hypothesisId:'H4',location:'csv-dashboard-import.service.ts:418',message:'message ingest/post-process failed',data:{dashboardId,provider,messageIdSuffix:safeMessageId,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          // #region agent debug
          const errMsg = error instanceof Error ? error.message : String(error);
          stepLogs.push(`${safeMessageId}:outer-catch:${errMsg.slice(0, 100)}`);
          errorDetails.push({ messageIdSuffix: safeMessageId || 'unknown', step: 'outer-catch', error: errMsg });
          // #endregion
          lastError = error;
          if (safeMessageId) failedMessageIdSuffixes.push(safeMessageId);
          if (safeMessageId) postProcessStateByMessageIdSuffix[safeMessageId] = 'failed';
          logger?.error(
            { err: error, dashboardId, messageId },
            '[CsvDashboardImportService] CSV dashboard ingestion failed for message'
          );
          if (provider === 'gmail' && messageId) {
            await this.appendIngestRunAudit({
              dashboardId,
              messageId,
              postProcessState: 'failed',
              reason: error instanceof Error ? error.message : String(error),
            });
          }
          if (
            provider === 'gmail' &&
            messageId &&
            CsvDashboardImportService.canPostProcessGmail(storageProvider) &&
            this.errorDispositionPolicy.classify(error) === 'NON_RETRIABLE'
          ) {
            try {
              await storageProvider.trashMessage(messageId);
              if (safeMessageId) {
                disposedMessageIdSuffixes.push(safeMessageId);
                postProcessStateByMessageIdSuffix[safeMessageId] = 'disposed_non_retriable';
                disposeReasonByMessageIdSuffix[safeMessageId] =
                  error instanceof Error ? error.message : String(error);
              }
              await this.appendIngestRunAudit({
                dashboardId,
                messageId,
                postProcessState: 'disposed_non_retriable',
                reason: error instanceof Error ? error.message : String(error),
              });
              logger?.warn(
                {
                  dashboardId,
                  messageId,
                  disposition: 'NON_RETRIABLE',
                  postProcessState: 'disposed_non_retriable',
                },
                '[CsvDashboardImportService] Non-retriable CSV error: message moved to trash'
              );
            } catch (disposeError) {
              if (safeMessageId) {
                postProcessStateByMessageIdSuffix[safeMessageId] = 'failed';
                postProcessErrorByMessageIdSuffix[safeMessageId] = {
                  step: 'trashMessage',
                  error: disposeError instanceof Error ? disposeError.message : String(disposeError),
                };
              }
              await this.appendIngestRunAudit({
                dashboardId,
                messageId,
                postProcessState: 'failed',
                reason: disposeError instanceof Error ? disposeError.message : String(disposeError),
              });
              logger?.error(
                {
                  err: disposeError,
                  dashboardId,
                  messageId,
                  disposition: 'NON_RETRIABLE',
                  postProcessState: 'failed',
                },
                '[CsvDashboardImportService] Failed to trash non-retriable error message'
              );
            }
          }
          continue;
        }
      }

      if (lastError && failedMessageIdSuffixes.length > 0) {
        // #region agent log
        fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4605d2'},body:JSON.stringify({sessionId:'4605d2',runId:'post-fix',hypothesisId:'H4',location:'csv-dashboard-import.service.ts:499',message:'escalate dashboard run failure due to per-message failure',data:{dashboardId,provider,failedMessageCount:failedMessageIdSuffixes.length,failedMessageIdSuffixes},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        throw lastError;
      }

      const aggregatedResult = {
        rowsProcessed: totalProcessed,
        rowsAdded: totalAdded,
        rowsSkipped: totalSkipped,
        debug: {
          provider,
          bufferResultsCount: bufferResults.length,
          downloadedMessageIdSuffixes,
          postProcessedMessageIdSuffixes,
          disposedMessageIdSuffixes,
          postProcessStateByMessageIdSuffix:
            Object.keys(postProcessStateByMessageIdSuffix).length > 0
              ? postProcessStateByMessageIdSuffix
              : undefined,
          failedMessageIdSuffixes,
          postProcessErrorByMessageIdSuffix:
            Object.keys(postProcessErrorByMessageIdSuffix).length > 0 ? postProcessErrorByMessageIdSuffix : undefined,
          disposeReasonByMessageIdSuffix:
            Object.keys(disposeReasonByMessageIdSuffix).length > 0 ? disposeReasonByMessageIdSuffix : undefined,
          canPostProcessGmail,
          // #region agent debug
          stepLogs,
          errorDetails,
          // #endregion
        },
      };
      // #region agent log
      fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4605d2'},body:JSON.stringify({sessionId:'4605d2',runId:'gmail-manual-run',hypothesisId:'H4',location:'csv-dashboard-import.service.ts:527',message:'dashboard ingestion aggregate result',data:{dashboardId,provider,rowsProcessed:aggregatedResult.rowsProcessed,rowsAdded:aggregatedResult.rowsAdded,rowsSkipped:aggregatedResult.rowsSkipped,debug:aggregatedResult.debug},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      results[dashboardId] = aggregatedResult;
      logger?.info({ dashboardId, result: aggregatedResult }, '[CsvDashboardImportService] CSV dashboard ingestion completed');
    }

    return results;
  }
}

