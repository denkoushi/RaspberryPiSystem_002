import { wakeSessakuAutoUnitSplit } from '../../../services/production-schedule/sessaku-pieces/auto-unit-split.scheduler.js';
import { runSessakuPieceOperation, type PieceAuditContext } from '../../../services/production-schedule/sessaku-pieces/piece-audit.js';
import { resolveDeviceName } from '../shared.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { classifyErrorResponse } from '../../../lib/error-response.js';
import { splitSessakuPieces, mergeSessakuPieces, splitSessakuPieceOps, mergeSessakuPieceOps, setSessakuPieceCompletion, setSessakuPieceOpCompletion } from '../../../services/production-schedule/sessaku-pieces/sessaku-pieces.service.js';
import { sessakuPiecesSplitSchema, sessakuPiecesMergeSchema, sessakuPieceCompletionSchema, sessakuPieceOpsSplitSchema, sessakuPieceOpsMergeSchema } from '../../../services/production-schedule/sessaku-pieces/sessaku-pieces.schemas.js';
import { sessakuPieceIdFromItemId } from '../../../services/production-schedule/sessaku-pieces/piece-key.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerSessakuPiecesRoutes(app: FastifyInstance, deps: KioskRouteDeps): Promise<void> {
  const base = '/kiosk/production-schedule/grinding-planning-board/pieces';
  const perform = async (request: FastifyRequest, action: string, operation: (audit: PieceAuditContext) => Promise<unknown>) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']).catch((error: unknown) => {
      const { status: httpStatus, errorCode } = classifyErrorResponse(error);
      request.log.warn({ event: 'sessaku_piece.auth_failed', outcome: 'rejected', requestId: request.id, action, httpStatus, errorCode }, 'Sessaku piece authentication failed');
      throw error;
    });
    return runSessakuPieceOperation({ requestId: request.id, action, actorClientDeviceId: clientDevice.id,
      actorDeviceName: resolveDeviceName(clientDevice) }, async (audit) => {
      audit.siteKey = deps.resolveLocationScopeContext(clientDevice).siteKey;
      return operation(audit);
    });
  };
  app.post(`${base}/auto-unit-split`, { config: { rateLimit: false } }, async (request) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    z.object({}).strict().parse(request.body ?? {});
    wakeSessakuAutoUnitSplit();
    return { splitCount: 0, skippedCount: 0, hasMore: false };
  });
  app.put(`${base}/:pieceId/ops/:opNo/completion`, { config: { rateLimit: false } }, async (request) => perform(request,
    sessakuPieceCompletionSchema.pick({ intent: true }).safeParse(request.body).data?.intent === 'incomplete' ? 'op_uncomplete' : 'op_complete', async (audit) => {
      const { pieceId, opNo } = z.object({ pieceId: z.string().uuid(), opNo: z.coerce.number().int().min(1).max(20) }).parse(request.params);
      const body = sessakuPieceCompletionSchema.parse(request.body);
      Object.assign(audit, { pieceIds: [pieceId], expectedVersion: body.expectedPieceSetVersion, itemRevision: body.itemRevision });
      return setSessakuPieceOpCompletion({ ...body, siteKey: audit.siteKey!, pieceId, opNo, audit });
    }));
  app.post(`${base}/ops/split`, { config: { rateLimit: false } }, async (request) => perform(request, 'op_split', async (audit) => {
    const body = sessakuPieceOpsSplitSchema.parse(request.body);
    Object.assign(audit, { pieceIds: [sessakuPieceIdFromItemId(body.itemId)!], expectedVersion: body.expectedPieceSetVersion, itemRevision: body.itemRevision,
      beforeJson: { itemId: body.itemId, fromOpNo: body.fromOpNo } });
    return splitSessakuPieceOps({ ...body, siteKey: audit.siteKey!, audit });
  }));
  app.post(`${base}/ops/merge`, { config: { rateLimit: false } }, async (request) => perform(request, 'op_merge', async (audit) => {
    const body = sessakuPieceOpsMergeSchema.parse(request.body);
    Object.assign(audit, { pieceIds: [sessakuPieceIdFromItemId(body.itemId)!], expectedVersion: body.expectedPieceSetVersion, itemRevision: body.itemRevision,
      beforeJson: { itemId: body.itemId } });
    return mergeSessakuPieceOps({ ...body, siteKey: audit.siteKey!, audit });
  }));
  app.post(`${base}/split`, { config: { rateLimit: false } }, async (request) => perform(request, 'split', async (audit) => {
    // Preserve numeric split input even when schema validation rejects it; never copy arbitrary bodies.
    const requested = z.object({ quantities: z.array(z.number()).max(2000) }).safeParse(request.body);
    if (requested.success) audit.requestedQuantities = requested.data.quantities;
    const body = sessakuPiecesSplitSchema.parse(request.body);
    Object.assign(audit, { parentItemId: body.parentItemId, pieceIds: body.targetPieceId ? [body.targetPieceId] : [], expectedVersion: body.expectedPieceSetVersion, itemRevision: body.itemRevision });
    return splitSessakuPieces({ ...body, siteKey: audit.siteKey!, audit });
  }));
  app.post(`${base}/merge`, { config: { rateLimit: false } }, async (request) => perform(request, 'merge', async (audit) => {
    const body = sessakuPiecesMergeSchema.parse(request.body);
    Object.assign(audit, { parentItemId: body.parentItemId, pieceIds: body.pieceIds, expectedVersion: body.expectedPieceSetVersion, itemRevisions: Object.fromEntries(body.pieceIds.filter((id) => body.itemRevisions[`piece:${id}`] !== undefined).map((id) => [`piece:${id}`, body.itemRevisions[`piece:${id}`]])) });
    return mergeSessakuPieces({ ...body, siteKey: audit.siteKey!, audit });
  }));
  app.put(`${base}/:pieceId/completion`, { config: { rateLimit: false } }, async (request) => perform(request, sessakuPieceCompletionSchema.pick({ intent: true }).safeParse(request.body).data?.intent === 'incomplete' ? 'uncomplete' : 'complete', async (audit) => {
    const { pieceId } = z.object({ pieceId: z.string().uuid() }).parse(request.params);
    const body = sessakuPieceCompletionSchema.parse(request.body);
    Object.assign(audit, { action: body.intent === 'complete' ? 'complete' : 'uncomplete', pieceIds: [pieceId], expectedVersion: body.expectedPieceSetVersion, itemRevision: body.itemRevision });
    return setSessakuPieceCompletion({ ...body, siteKey: audit.siteKey!, pieceId, audit });
  }));
}
