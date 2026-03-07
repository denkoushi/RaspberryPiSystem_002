import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../lib/auth.js';
import {
  getProductionScheduleProcessingTypeOptions,
  getProductionScheduleResourceCategorySettings,
  listProductionScheduleResourceCategorySettingsLocations,
  upsertProductionScheduleProcessingTypeOptions,
  upsertProductionScheduleResourceCategorySettings
} from '../services/production-schedule/production-schedule-settings.service.js';

const resourceCategoryQuerySchema = z.object({
  location: z.string().min(1).max(100).default('shared')
});

const resourceCategoryBodySchema = z.object({
  location: z.string().min(1).max(100),
  cuttingExcludedResourceCds: z.array(z.string().min(1).max(100)).max(300)
});

const processingTypeOptionsQuerySchema = z.object({
  location: z.string().min(1).max(100).default('shared')
});

const processingTypeOptionsBodySchema = z.object({
  location: z.string().min(1).max(100),
  options: z
    .array(
      z.object({
        code: z.string().min(1).max(20),
        label: z.string().min(1).max(40),
        priority: z.coerce.number().int().min(1).max(999),
        enabled: z.boolean()
      })
    )
    .max(100)
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

  app.get('/production-schedule-settings/processing-type-options', { preHandler: canManage }, async (request) => {
    const query = processingTypeOptionsQuerySchema.parse(request.query);
    const [settings, locations] = await Promise.all([
      getProductionScheduleProcessingTypeOptions(query.location),
      listProductionScheduleResourceCategorySettingsLocations()
    ]);
    return {
      settings,
      locations
    };
  });

  app.put('/production-schedule-settings/processing-type-options', { preHandler: canManage }, async (request) => {
    const body = processingTypeOptionsBodySchema.parse(request.body);
    const settings = await upsertProductionScheduleProcessingTypeOptions({
      location: body.location,
      options: body.options
    });
    return { settings };
  });
}
