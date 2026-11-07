import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { ApiError, DomainHttpError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';

// Audit events must also be emitted with the production default LOG_LEVEL=warn.
const auditLogger = logger.child({}, { level: 'info' });

// Only IDs, revisions and quantities belong here; never pass request bodies or headers.
export type PieceAuditContext = {
  requestId?: string; siteKey?: string; actorClientDeviceId?: string; actorDeviceName?: string;
  action: string; fseiban?: string; parentItemId?: string; pieceIds?: string[];
  expectedVersion?: number; itemRevision?: string; itemRevisions?: Record<string, string>;
  beforeJson?: Prisma.InputJsonObject; afterJson?: Prisma.InputJsonObject; resultVersion?: number;
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
    const error = failure as { statusCode?: number; code?: string; message?: string } | undefined;
    const httpStatus = failure instanceof ZodError ? 400 : failed ? error?.statusCode ?? 500 : 200;
    const outcome = failed ? (httpStatus < 500 ? 'rejected' : 'failed') : 'success';
    // Unknown exceptions can contain SQL, credentials or user input. Keep their message generic.
    const message = failed ? (httpStatus < 500 && (failure instanceof ApiError || failure instanceof DomainHttpError) ? failure.message : httpStatus === 400 ? 'Invalid request' : 'Internal server error') : null;
    const { itemRevision, itemRevisions, ...fields } = context;
    const data = {
      ...fields, createdAt: new Date(), requestId: context.requestId ?? null, siteKey: context.siteKey ?? null,
      pieceIds: context.pieceIds ?? [], beforeJson: context.beforeJson ?? null,
      afterJson: outcome === 'success' ? context.afterJson ?? null : context.beforeJson ?? null,
      itemRevision: itemRevision ?? null, itemRevisions: itemRevisions ?? null,
      resultVersion: outcome === 'success' ? context.resultVersion ?? null : null,
      outcome, errorCode: error?.code ?? (failed ? failure instanceof ZodError ? 'VALIDATION_ERROR' : `API_ERROR_${httpStatus}` : null), httpStatus, message
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
