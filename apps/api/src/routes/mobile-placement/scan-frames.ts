import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { listPlacementPhotos, placementPhotoQuerySchema, readMobileScanFrame, saveMobileScanFrame, scanFrameBodySchema } from '../../services/mobile-placement/mobile-scan-frame.service.js';
import { requireClientDevice } from '../kiosk/shared.js';

export async function registerMobileScanFrameRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mobile-placement/scan-frames', { bodyLimit: 1.5 * 1024 * 1024 }, async (request, reply) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const saved = await saveMobileScanFrame(scanFrameBodySchema.parse(request.body), clientDevice.id);
    return reply.code(201).send(saved);
  });
  app.get('/mobile-placement/admin/placement-photos', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    return { photos: await listPlacementPhotos(placementPhotoQuerySchema.parse(request.query)) };
  });
  app.get('/mobile-placement/admin/scan-frames/:id/:variant', { preHandler: authorizeRoles('ADMIN') }, async (request, reply) => {
    const { id, variant } = z.object({ id: z.string().uuid(), variant: z.enum(['crop', 'full', 'crop-thumb', 'full-thumb']) }).parse(request.params);
    const bytes = await readMobileScanFrame(id, variant);
    return reply.header('Cache-Control', variant.endsWith('-thumb') ? 'private, max-age=86400' : 'private').type('image/jpeg').send(bytes);
  });
}
