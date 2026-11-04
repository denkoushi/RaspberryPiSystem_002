import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { getScheduleSeiban, listScheduleSeibans } from '../../services/mobile-placement/schedule-seiban-status.service.js';

type ScheduleDeps = { requireClientDevice: (rawClientKey: unknown) => Promise<unknown> };

export async function registerMobilePlacementScheduleSeibansRoutes(app: FastifyInstance, deps: ScheduleDeps): Promise<void> {
  app.get('/mobile-placement/schedule-seibans', { config: { rateLimit: false } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    reply.header('Cache-Control', 'no-store');
    return listScheduleSeibans();
  });
  app.get('/mobile-placement/schedule-seibans/:fseiban', { config: { rateLimit: false } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const { fseiban } = z.object({ fseiban: z.string().min(1).max(200) }).parse(request.params);
    const result = await getScheduleSeiban(fseiban);
    if (!result) throw new ApiError(404, '製番が見つかりません');
    reply.header('Cache-Control', 'no-store');
    return result;
  });
}
