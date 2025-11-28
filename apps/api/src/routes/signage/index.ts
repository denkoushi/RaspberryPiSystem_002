import type { FastifyInstance } from 'fastify';
import { SignageService } from '../../services/signage/index.js';
import { registerScheduleRoutes } from './schedules.js';
import { registerContentRoute } from './content.js';
import { registerPdfRoutes } from './pdfs.js';
import { registerEmergencyRoutes } from './emergency.js';

export async function registerSignageRoutes(app: FastifyInstance): Promise<void> {
  const signageService = new SignageService();

  await app.register(
    async (subApp) => {
      registerScheduleRoutes(subApp, signageService);
      registerContentRoute(subApp, signageService);
      registerPdfRoutes(subApp, signageService);
      registerEmergencyRoutes(subApp, signageService);
    },
    { prefix: '/signage' },
  );
}

