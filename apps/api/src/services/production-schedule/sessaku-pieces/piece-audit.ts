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
    const { itemRevision, itemRevisions, resultPieceIds, ...fields } = context;
    const beforeJson = boundedSnapshot(context.beforeJson);
    const data = {
      ...fields, createdAt: new Date(), requestId: context.requestId ?? null, siteKey: context.siteKey ?? null,
      pieceIds: (failed ? context.pieceIds : resultPieceIds ?? context.pieceIds) ?? [], beforeJson,
      afterJson: outcome === 'success' ? boundedSnapshot(context.afterJson) : beforeJson,
      itemRevision: itemRevision ?? null, itemRevisions: itemRevisions ?? null,
      resultVersion: outcome === 'success' ? context.resultVersion ?? null : null,
      outcome, errorCode: classification?.errorCode ?? null, httpStatus, message
    };
    auditLogger.info({ event: `sessaku_piece.${context.action}`, ...data }, 'Sessaku piece operation');
    try {
      // Deliberately outside the business transaction, including its rejection/rollback path.
      await prisma.productionScheduleSessakuPieceAuditLog.create({ data: { ...data, beforeJson: data.beforeJson ?? Prisma.JsonNull, afterJson: data.afterJson ?? Prisma.JsonNull, itemRevisions: data.itemRevisions ?? Prisma.JsonNull } });
    } catch {
      logger.warn({ event: 'sessaku_piece.audit_write_failed', requestId: context.requestId, action: context.action }, 'Sessaku piece audit write failed');
    }
  }
}
