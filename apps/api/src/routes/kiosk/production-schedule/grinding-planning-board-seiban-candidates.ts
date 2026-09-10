import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getGrindingPlanningBoardSeibanCandidates } from '../../../services/production-schedule/grinding-planning-board-seiban-candidates.service.js';
import type { KioskRouteDeps } from './shared.js';

const querySchema = z.object({
  category: z.enum(['grinding', 'cutting']).default('grinding'),
  completionFilter: z.enum(['all', 'incomplete']).default('incomplete')
});

export async function registerProductionScheduleGrindingPlanningBoardSeibanCandidatesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.get('/kiosk/production-schedule/grinding-planning-board/seiban-candidates', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const scope = deps.resolveLocationScopeContext(clientDevice);
    const query = querySchema.parse(request.query);
    return getGrindingPlanningBoardSeibanCandidates({
      siteKey: scope.siteKey,
      category: query.category,
      completionFilter: query.completionFilter
    });
  });
}
