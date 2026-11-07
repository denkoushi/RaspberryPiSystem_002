import { logger } from '../../lib/logger.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from './fkojunst-status-mail-critical-lock.js';
import { readLaterPieceAuditSnapshots, collectLaterPiecePropagationAudits, writeLaterPiecePropagationAudits, type PieceAuditContext } from './sessaku-pieces/piece-audit.js';
import { acquireSessakuPieceLogicalLocks, readSessakuPieceSets, encodeSessakuPieceKey, sessakuPieceKeyFromRow } from './sessaku-pieces/piece-key.js';
import { synchronizeSessakuPieceSources } from './sessaku-pieces/piece-sync.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { resolveUpdatedAt } from '../csv-dashboard/diff/csv-dashboard-updated-at.js';
import { dueManagementLearningEventRepository } from './due-management-learning-event.repository.js';
import { decideCsvProgressSyncForProductionScheduleRow } from './progress-csv-sync-decision.policy.js';

type ProgressSyncCandidate = {
  rowId: string;
  rowData: Prisma.JsonValue;
  occurredAt: Date;
};

type SyncProgressFromCsvParams = {
  candidates: ProgressSyncCandidate[];
  locationKey?: string;
  hasProgressColumn?: boolean;
};

const normalizeProgress = (value: unknown): string => String(value ?? '').trim();

export class ProgressSyncFromCsvService {
  async sync(params: SyncProgressFromCsvParams): Promise<void> {
    const { candidates, hasProgressColumn = true } = params;
    if (candidates.length === 0) {
      return;
    }

    // Without a progress column only already split rows need source reconciliation.
    const initialSets = !hasProgressColumn ? await readSessakuPieceSets(prisma, candidates) : null;
    const pending = initialSets ? candidates.filter((candidate) => initialSets.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(candidate.rowData)))?.pieces.length || initialSets.get(encodeSessakuPieceKey(sessakuPieceKeyFromRow(candidate.rowData)))?.sourcePieceSetId) : candidates;
    const propagationAudits: PieceAuditContext[] = [];
    const syncBatch = async (batch: ProgressSyncCandidate[]) => {
      const initial = await readSessakuPieceSets(prisma, batch);
      let needsCritical = [...initial.values()].some((set) => set.pieces.length || set.sourcePieceSetId);
      const retryWithCritical = new Error('Piece set appeared while locking');
      const execute = () => prisma.$transaction(async (tx) => {
        const keys = batch.map((candidate) => sessakuPieceKeyFromRow(candidate.rowData));
        if (needsCritical) await acquireFkojunstStatusMailCriticalTransactionLock(tx);
        await acquireSessakuPieceLogicalLocks(tx, keys, { onlyPartsWithSets: true });
        const rows = await tx.csvDashboardRow.findMany({
          where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, id: { in: batch.map((candidate) => candidate.rowId) } },
          select: { id: true, rowData: true, occurredAt: true }
        });
        const [sets, progressRows] = await Promise.all([
          readSessakuPieceSets(tx, rows),
          tx.productionScheduleProgress.findMany({
            where: { csvDashboardRowId: { in: rows.map((row) => row.id) } },
            select: { csvDashboardRowId: true, updatedAt: true, isCompleted: true }
          })
        ]);
        // A first split may have committed while this ordinary batch waited for its logical locks.
        // Release those locks before acquiring critical, preserving critical -> logical -> board -> row.
        if (!needsCritical && [...sets.values()].some((set) => set.pieces.length || set.sourcePieceSetId)) throw retryWithCritical;
        const before = await readLaterPieceAuditSnapshots(tx, keys);
        const byId = new Map(rows.map((row) => [row.id, row]));
        const progressById = new Map(progressRows.map((progress) => [progress.csvDashboardRowId, progress]));
        for (const candidate of batch) {
          const row = byId.get(candidate.rowId);
          const key = sessakuPieceKeyFromRow(candidate.rowData);
          if (!row || encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)) !== encodeSessakuPieceKey(key)) continue;
          if (sets.get(encodeSessakuPieceKey(key))?.pieces.length || sets.get(encodeSessakuPieceKey(key))?.sourcePieceSetId) {
            await synchronizeSessakuPieceSources(tx, [key]);
            continue;
          }
          if (!hasProgressColumn) continue;
          const rowData = row.rowData as Record<string, unknown> | null;
          const csvUpdatedAt = resolveUpdatedAt(row.rowData, row.occurredAt);
          const existing = progressById.get(row.id);
          // 同時刻は本システム側優先（CSVは上書きしない）
          if (existing && csvUpdatedAt.getTime() <= existing.updatedAt.getTime()) continue;
          const decision = decideCsvProgressSyncForProductionScheduleRow({
            progressNormalized: normalizeProgress(rowData?.progress),
            existingIsCompleted: existing?.isCompleted
          });
          if (decision.kind === 'skip') continue;
          const isCompleted = decision.isCompleted;
          await tx.productionScheduleProgress.upsert({
            where: { csvDashboardRowId: row.id },
            create: { csvDashboardRowId: row.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isCompleted, updatedAt: csvUpdatedAt },
            update: { isCompleted, updatedAt: csvUpdatedAt }
          });
          if (!existing || existing.isCompleted !== isCompleted) {
            const fseiban = typeof rowData?.FSEIBAN === 'string' ? rowData.FSEIBAN.trim() : '';
            await dueManagementLearningEventRepository.saveOutcomeEvent({
              locationKey: params.locationKey?.trim() || '__shared__', eventType: 'progress_sync',
              csvDashboardRowId: row.id, fseiban: fseiban || null, isCompleted, occurredAt: csvUpdatedAt,
              metadata: { from: 'csv_progress_sync' }
            }, tx);
          }
        }
        return collectLaterPiecePropagationAudits(before, await readLaterPieceAuditSnapshots(tx, keys), params.locationKey?.trim() || '__shared__');
      }, { timeout: 30000, maxWait: 15000 });
      try {
        return await execute();
      } catch (error) {
        if (error !== retryWithCritical) throw error;
        needsCritical = true;
        return execute();
      }
    };
    let failedRows = 0;
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100);
      try {
        propagationAudits.push(...await syncBatch(batch));
      } catch {
        logger.warn({ count: batch.length, rowIds: batch.slice(0, 5).map((candidate) => candidate.rowId) }, 'CSV progress sync batch failed');
        // Each retry commits independently so one bad row cannot discard the others.
        for (const candidate of batch) {
          try {
            propagationAudits.push(...await syncBatch([candidate]));
          } catch {
            failedRows++;
          }
        }
      }
    }
    await writeLaterPiecePropagationAudits(propagationAudits);
    if (failedRows) throw new Error(`CSV progress sync failed for ${failedRows} rows`);
  }
}
