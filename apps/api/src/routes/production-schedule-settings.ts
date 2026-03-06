import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../lib/auth.js';
import {
  getProductionScheduleResourceCategorySettings,
  listProductionScheduleResourceCategorySettingsLocations,
  upsertProductionScheduleResourceCategorySettings
} from '../services/production-schedule/production-schedule-settings.service.js';

const resourceCategoryQuerySchema = z.object({
  location: z.string().min(1).max(100).default('shared')
});

const resourceCategoryBodySchema = z.object({
  location: z.string().min(1).max(100),
  cuttingExcludedResourceCds: z.array(z.string().min(1).max(100)).max(300)
});

export function registerProductionScheduleSettingsRoutes(app: FastifyInstance): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/production-schedule-settings/resource-categories', { preHandler: canManage }, async (request) => {
    const query = resourceCategoryQuerySchema.parse(request.query);
    const [settings, locations] = await Promise.all([
      getProductionScheduleResourceCategorySettings(query.location),
      listProductionScheduleResourceCategorySettingsLocations()
    ]);
    return {
      settings,
      locations
    };
  });

  app.put('/production-schedule-settings/resource-categories', { preHandler: canManage }, async (request) => {
    const body = resourceCategoryBodySchema.parse(request.body);
    const settings = await upsertProductionScheduleResourceCategorySettings({
      location: body.location,
      cuttingExcludedResourceCds: body.cuttingExcludedResourceCds
    });
    return { settings };
  });
}
