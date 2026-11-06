import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { splitSessakuPieces, mergeSessakuPieces, setSessakuPieceCompletion } from '../../../services/production-schedule/sessaku-pieces/sessaku-pieces.service.js';
import { sessakuPiecesSplitSchema, sessakuPiecesMergeSchema, sessakuPieceCompletionSchema } from '../../../services/production-schedule/sessaku-pieces/sessaku-pieces.schemas.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerSessakuPiecesRoutes(app: FastifyInstance, deps: KioskRouteDeps): Promise<void> {
  const base = '/kiosk/production-schedule/grinding-planning-board/pieces';
  app.post(`${base}/split`, { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const { siteKey } = deps.resolveLocationScopeContext(clientDevice);
    return splitSessakuPieces({ ...sessakuPiecesSplitSchema.parse(request.body), siteKey });
  });
  app.post(`${base}/merge`, { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const { siteKey } = deps.resolveLocationScopeContext(clientDevice);
    return mergeSessakuPieces({ ...sessakuPiecesMergeSchema.parse(request.body), siteKey });
  });
  app.put(`${base}/:pieceId/completion`, { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const { siteKey } = deps.resolveLocationScopeContext(clientDevice);
    const { pieceId } = z.object({ pieceId: z.string().uuid() }).parse(request.params);
    return setSessakuPieceCompletion({ ...sessakuPieceCompletionSchema.parse(request.body), siteKey, pieceId });
  });
}
