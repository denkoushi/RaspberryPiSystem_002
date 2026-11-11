import { AsyncLocalStorage } from 'node:async_hooks';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { encodeSessakuPieceKey, supportsSessakuPieceRelations, sessakuPieceParentItemId, type SessakuPieceLogicalKey } from './piece-key.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { ApiError, DomainHttpError } from '../../../lib/errors.js';
import { classifyErrorResponse } from '../../../lib/error-response.js';
import { logger } from '../../../lib/logger.js';

// Audit events must also be emitted with the production default LOG_LEVEL=warn.
let auditLogger: ReturnType<typeof logger.child> | undefined;
const getAuditLogger = () => (auditLogger ??= logger.child({}, { level: 'info' }));

// The production-scale test counts driver SQL under these stages without logging SQL or binds.
export const pieceTimingStage = new AsyncLocalStorage<string>();

// Only IDs, revisions and quantities belong here; never pass request bodies or headers.
export type PieceOperationTiming = {
  lockWaitMs: number; beforeProjectionMs: number; siteCount: number; writeMs: number;
  upsertCount: number; afterProjectionMs: number; totalMs: number;
  sourceWinnerMs: number; sourceDetailsMs: number; sourcePieceSetsMs: number;
  overridesMs: number; ranksMs: number; projectMs: number; sourceRowCount: number;
  laneDiscoveryMs: number;
  candidateMs: number; candidateSqlCount: number;
  pieceCreationMs: number; propagationMs: number; rerankMs: number; siteVersionMs: number;
  versionUpdateMs: number; placementUpsertMs: number;
  replaceSiteItemsCount: number; laneWriteCount: number; repeatedLaneCount: number;
  versionUpdateCount: number; versionUpdateSqlCount: number; placementUpsertSqlCount: number;
  // Delegate calls include raw SQL. Prisma relation reads may issue more than one SQL statement.
  dbCallCount: number; lockDbCallCount: number; projectionDbCallCount: number;
  pieceCreationDbCallCount: number; propagationDbCallCount: number; siteVersionDbCallCount: number;
};

export type PieceAuditContext = {
  requestId?: string; siteKey?: string; actorClientDeviceId?: string; actorDeviceName?: string;
  action: string; fseiban?: string; parentItemId?: string; pieceIds?: string[]; resultPieceIds?: string[];
  requestedQuantities?: number[]; timing?: PieceOperationTiming;
  expectedVersion?: number; itemRevision?: string; itemRevisions?: Record<string, string>;
  beforeJson?: Prisma.InputJsonObject; afterJson?: Prisma.InputJsonObject; resultVersion?: number;
};

const boundedSnapshot = (snapshot: Prisma.InputJsonObject | undefined): Prisma.InputJsonObject | null => {
  if (!snapshot) return null;
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  if (bytes <= 64 * 1024) return snapshot;
  return {
    truncated: true,
    pieceCount: Array.isArray(snapshot.pieceIds) ? snapshot.pieceIds.length : snapshot.count ?? null,
    serializedBytes: bytes
  };
};

export async function runSessakuPieceOperation<T>(context: PieceAuditContext, operation: (audit: PieceAuditContext) => Promise<T>, options?: { tx: Prisma.TransactionClient; successOnly?: boolean }): Promise<T> {
  const started = performance.now();
  context.timing = { lockWaitMs: 0, beforeProjectionMs: 0, siteCount: 0, writeMs: 0, upsertCount: 0, afterProjectionMs: 0, totalMs: 0,
    sourceWinnerMs: 0, sourceDetailsMs: 0, sourcePieceSetsMs: 0, overridesMs: 0, ranksMs: 0, projectMs: 0, sourceRowCount: 0, laneDiscoveryMs: 0,
    candidateMs: 0, candidateSqlCount: 0, pieceCreationMs: 0, propagationMs: 0, rerankMs: 0, siteVersionMs: 0,
    versionUpdateMs: 0, placementUpsertMs: 0, replaceSiteItemsCount: 0, laneWriteCount: 0, repeatedLaneCount: 0,
    versionUpdateCount: 0, versionUpdateSqlCount: 0, placementUpsertSqlCount: 0,
    dbCallCount: 0, lockDbCallCount: 0, projectionDbCallCount: 0, pieceCreationDbCallCount: 0,
    propagationDbCallCount: 0, siteVersionDbCallCount: 0 };
  let failure: unknown;
  let failed = false;
  let result: T | undefined;
  try {
    result = await operation(context);
  } catch (error) {
    failure = error;
    failed = true;
  }
  context.timing.totalMs = performance.now() - started;
  const classification = failed ? classifyErrorResponse(failure) : null;
  const httpStatus = classification?.status ?? 200;
  const outcome = failed ? (httpStatus < 500 ? 'rejected' : 'failed') : 'success';
  // Unknown exceptions can contain SQL, credentials or user input. Keep their message generic.
  const message = failed ? (httpStatus < 500 && (failure instanceof ApiError || failure instanceof DomainHttpError) ? failure.message : httpStatus === 400 ? 'Invalid request' : 'Internal server error') : null;
  const beforeJson = boundedSnapshot(context.beforeJson);
  const pieceIds = (failed ? context.pieceIds : context.resultPieceIds ?? context.pieceIds) ?? [];
  const data: Prisma.ProductionScheduleSessakuPieceAuditLogCreateInput = {
    createdAt: new Date(), requestId: context.requestId ?? null, siteKey: context.siteKey ?? null,
    actorClientDeviceId: context.actorClientDeviceId ?? null, actorDeviceName: context.actorDeviceName ?? null,
    action: context.action, outcome, errorCode: classification?.errorCode ?? null, httpStatus, message,
    fseiban: context.fseiban ?? null, parentItemId: context.parentItemId ?? null, pieceIds,
    requestedQuantities: context.requestedQuantities ?? Prisma.DbNull,
    timing: context.timing,
    beforeJson: beforeJson ?? Prisma.JsonNull,
    afterJson: (outcome === 'success' ? boundedSnapshot(context.afterJson) : beforeJson) ?? Prisma.JsonNull,
    expectedVersion: context.expectedVersion ?? null, itemRevision: context.itemRevision ?? null,
    itemRevisions: context.itemRevisions ?? Prisma.JsonNull,
    resultVersion: outcome === 'success' ? context.resultVersion ?? null : null
  };
  if (!options?.successOnly) getAuditLogger().info({
    event: `sessaku_piece.${context.action}`, requestId: data.requestId, action: data.action,
    outcome, httpStatus, errorCode: data.errorCode, siteKey: data.siteKey,
    actorClientDeviceId: data.actorClientDeviceId, actorDeviceName: data.actorDeviceName,
    fseiban: data.fseiban, parentItemId: data.parentItemId, pieceCount: pieceIds.length,
    pieceIds: pieceIds.slice(0, 5), requestedQuantities: context.requestedQuantities?.slice(0, 20) ?? null,
    ...context.timing, expectedVersion: data.expectedVersion, resultVersion: data.resultVersion
  }, 'Sessaku piece operation');
  try {
    // Manual audits survive rollback; automatic successes belong to their lot SAVEPOINT.
    if (!failed || !options?.successOnly) await (options?.tx ?? prisma).productionScheduleSessakuPieceAuditLog.create({ data });
  } catch (error) {
    if (options?.tx) throw error;
    logger.warn({ event: 'sessaku_piece.audit_write_failed', requestId: context.requestId, action: context.action }, 'Sessaku piece audit write failed');
  }
  if (failed) throw failure;
  return result as T;
}

// Snapshots contain only IDs, quantities and completion evidence, never CSV payloads.
export type LaterPieceAuditSnapshot = {
  key: SessakuPieceLogicalKey;
  sets: { setId: string; pieces: { id: string; sourcePieceId: string | null; quantity: number; isCompleted: boolean }[] }[];
};

export async function readLaterPieceAuditSnapshots(tx: Prisma.TransactionClient, keys: readonly SessakuPieceLogicalKey[], before: readonly LaterPieceAuditSnapshot[] = []): Promise<LaterPieceAuditSnapshot[]> {
  const byPart = new Map<string, SessakuPieceLogicalKey>();
  for (const key of keys) {
    const part = JSON.stringify([key.fseiban, key.fhincd]);
    const previous = byPart.get(part);
    if (!previous || !supportsSessakuPieceRelations(previous)
      || (supportsSessakuPieceRelations(key) && encodeSessakuPieceKey(key) < encodeSessakuPieceKey(previous))) byPart.set(part, key);
  }
  const parts = [...byPart.values()];
  if (!parts.length) return [];
  const sets = await tx.productionScheduleSessakuPieceSet.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: parts.map(({ fseiban, fhincd }) => ({ fseiban, fhincd })),
      AND: { OR: [{ id: { in: before.flatMap((part) => part.sets.map((set) => set.setId)) } }, { sourcePieceSetId: { not: null } }, { pieces: { some: { sourcePieceId: { not: null } } } }] } },
    include: { pieces: { orderBy: { position: 'asc' } } }, orderBy: { id: 'asc' }
  });
  return parts.map((key) => ({ key, sets: sets.filter((set) => set.fseiban === key.fseiban && set.fhincd === key.fhincd)
    .map((set) => ({ setId: set.id, pieces: set.pieces.map(({ id, sourcePieceId, quantity, isCompleted }) => ({ id, sourcePieceId, quantity, isCompleted })) })) }));
}

export type LaterPiecePropagationAudit = PieceAuditContext & { fseiban: string; fhincd: string; representativeKey: SessakuPieceLogicalKey };

export function collectLaterPiecePropagationAudits(before: LaterPieceAuditSnapshot[], after: LaterPieceAuditSnapshot[], siteKey: string): LaterPiecePropagationAudit[] {
  return before.flatMap((previous) => {
    const saved = after.find(({ key }) => key.fseiban === previous.key.fseiban && key.fhincd === previous.key.fhincd);
    if (JSON.stringify(previous.sets) === JSON.stringify(saved?.sets ?? [])) return [];
    return [{ action: 'propagate', siteKey, fseiban: previous.key.fseiban, fhincd: previous.key.fhincd, representativeKey: previous.key, parentItemId: sessakuPieceParentItemId(previous.key),
      beforeJson: { laterProcesses: previous.sets }, afterJson: { laterProcesses: saved?.sets ?? [] },
      resultPieceIds: [...new Set([...previous.sets, ...(saved?.sets ?? [])].flatMap((set) => set.pieces.map((piece) => piece.id)))] }];
  });
}

/** Call only after the business transaction has committed. */
export async function writeLaterPiecePropagationAudits(audits: readonly LaterPiecePropagationAudit[]) {
  try {
    const byPart = new Map<string, LaterPiecePropagationAudit>();
    for (const audit of audits) {
      const part = JSON.stringify([audit.fseiban, audit.fhincd]);
      const previous = byPart.get(part);
      const key = audit.representativeKey;
      const representative = !previous || !supportsSessakuPieceRelations(previous.representativeKey)
        || (supportsSessakuPieceRelations(key) && encodeSessakuPieceKey(key) < encodeSessakuPieceKey(previous.representativeKey)) ? audit : previous;
      byPart.set(part, previous ? { ...previous, representativeKey: representative.representativeKey, parentItemId: representative.parentItemId, afterJson: audit.afterJson,
        resultPieceIds: [...new Set([...(previous.resultPieceIds ?? []), ...(audit.resultPieceIds ?? [])])] } : audit);
    }
    for (const audit of byPart.values()) await runSessakuPieceOperation(audit, async () => undefined);
  } catch {
    logger.warn({ event: 'sessaku_piece.audit_write_failed', action: 'propagate' }, 'Sessaku piece audit write failed');
  }
}
