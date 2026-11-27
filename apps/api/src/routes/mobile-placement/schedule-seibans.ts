import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GRINDING_PLANNING_BOARD_SCHEDULE_SOURCES } from '@raspi-system/shared-types';

import { ApiError } from '../../lib/errors.js';
import { getScheduleSeiban, listScheduleSeibans } from '../../services/mobile-placement/schedule-seiban-status.service.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../lib/terminal-route-rate-limit.js';

type ScheduleDeps = { requireClientDevice: (rawClientKey: unknown) => Promise<unknown> };

export async function registerMobilePlacementScheduleSeibansRoutes(app: FastifyInstance, deps: ScheduleDeps): Promise<void> {
  app.get('/mobile-placement/schedule-seibans', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    reply.header('Cache-Control', 'no-store');
    const query = z.object({
      source: z.enum(GRINDING_PLANNING_BOARD_SCHEDULE_SOURCES).default('both'),
      range: z.enum(['all', 'aroundMonth', 'excludeOlderThanHalfYear']).default('all')
    }).parse(request.query);
    return listScheduleSeibans(query);
  });
  app.get('/mobile-placement/schedule-seibans/:fseiban', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const { fseiban } = z.object({ fseiban: z.string().min(1).max(200) }).parse(request.params);
    const result = await getScheduleSeiban(fseiban);
    if (!result) throw new ApiError(404, '製番が見つかりません');
    reply.header('Cache-Control', 'no-store');
    return result;
  });
}
