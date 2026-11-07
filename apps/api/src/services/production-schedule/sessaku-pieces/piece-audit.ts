import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { ApiError, DomainHttpError } from '../../../lib/errors.js';
import { classifyErrorResponse } from '../../../lib/error-response.js';
import { logger } from '../../../lib/logger.js';

// Audit events must also be emitted with the production default LOG_LEVEL=warn.
const auditLogger = logger.child({}, { level: 'info' });

// Only IDs, revisions and quantities belong here; never pass request bodies or headers.
export type PieceAuditContext = {
  requestId?: string; siteKey?: string; actorClientDeviceId?: string; actorDeviceName?: string;
  action: string; fseiban?: string; parentItemId?: string; pieceIds?: string[]; resultPieceIds?: string[];
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

export async function runSessakuPieceOperation<T>(context: PieceAuditContext, operation: (audit: PieceAuditContext) => Promise<T>): Promise<T> {
  let failure: unknown;
  let failed = false;
  try {
    return await operation(context);
  } catch (error) {
    failure = error;
    failed = true;
    throw error;
  } finally {
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
      beforeJson: beforeJson ?? Prisma.JsonNull,
      afterJson: (outcome === 'success' ? boundedSnapshot(context.afterJson) : beforeJson) ?? Prisma.JsonNull,
      expectedVersion: context.expectedVersion ?? null, itemRevision: context.itemRevision ?? null,
      itemRevisions: context.itemRevisions ?? Prisma.JsonNull,
      resultVersion: outcome === 'success' ? context.resultVersion ?? null : null
    };
    auditLogger.info({
      event: `sessaku_piece.${context.action}`, requestId: data.requestId, action: data.action,
      outcome, httpStatus, errorCode: data.errorCode, siteKey: data.siteKey,
      actorClientDeviceId: data.actorClientDeviceId, actorDeviceName: data.actorDeviceName,
      fseiban: data.fseiban, parentItemId: data.parentItemId, pieceCount: pieceIds.length,
      pieceIds: pieceIds.slice(0, 5), expectedVersion: data.expectedVersion, resultVersion: data.resultVersion
    }, 'Sessaku piece operation');
    try {
      // Deliberately outside the business transaction, including its rejection/rollback path.
      await prisma.productionScheduleSessakuPieceAuditLog.create({ data });
    } catch {
      logger.warn({ event: 'sessaku_piece.audit_write_failed', requestId: context.requestId, action: context.action }, 'Sessaku piece audit write failed');
    }
  }
}
