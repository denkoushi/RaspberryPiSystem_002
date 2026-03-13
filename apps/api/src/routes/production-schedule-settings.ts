import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../lib/auth.js';
import {
  getDueManagementAccessPasswordSettings,
  importProductionScheduleResourceCodeMappingsFromCsv,
  getProductionScheduleProcessingTypeOptions,
  getProductionScheduleResourceCodeMappings,
  getProductionScheduleResourceCategorySettings,
  listProductionScheduleResourceCategorySettingsLocations,
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  upsertDueManagementAccessPassword,
  upsertProductionScheduleResourceCodeMappings,
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

const resourceCodeMappingsQuerySchema = z.object({
  location: z.string().min(1).max(100).default('shared')
});

const resourceCodeMappingsBodySchema = z.object({
  location: z.string().min(1).max(100),
  mappings: z
    .array(
      z.object({
        fromResourceCd: z.string().min(1).max(20),
        toResourceCd: z.string().min(1).max(20),
        priority: z.coerce.number().int().min(1).max(999),
        enabled: z.boolean()
      })
    )
    .max(500)
});

const resourceCodeMappingsImportCsvBodySchema = z.object({
  location: z.string().min(1).max(100),
  csvText: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().default(true)
});

const dueManagementAccessPasswordQuerySchema = z.object({
  location: z.string().min(1).max(100).default(SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION)
});

const dueManagementAccessPasswordBodySchema = z.object({
  location: z.string().min(1).max(100).default(SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION),
  password: z.string().min(1).max(128)
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

  app.get('/production-schedule-settings/resource-code-mappings', { preHandler: canManage }, async (request) => {
    const query = resourceCodeMappingsQuerySchema.parse(request.query);
    const [settings, locations] = await Promise.all([
      getProductionScheduleResourceCodeMappings(query.location),
      listProductionScheduleResourceCategorySettingsLocations()
    ]);
    return {
      settings,
      locations
    };
  });

  app.put('/production-schedule-settings/resource-code-mappings', { preHandler: canManage }, async (request) => {
    const body = resourceCodeMappingsBodySchema.parse(request.body);
    const settings = await upsertProductionScheduleResourceCodeMappings({
      location: body.location,
      mappings: body.mappings
    });
    return { settings };
  });

  app.post('/production-schedule-settings/resource-code-mappings/import-csv', { preHandler: canManage }, async (request) => {
    const body = resourceCodeMappingsImportCsvBodySchema.parse(request.body);
    const result = await importProductionScheduleResourceCodeMappingsFromCsv({
      location: body.location,
      csvText: body.csvText,
      dryRun: body.dryRun
    });
    return { result };
  });

  app.get('/production-schedule-settings/due-management-access-password', { preHandler: canManage }, async (request) => {
    const query = dueManagementAccessPasswordQuerySchema.parse(request.query);
    const settings = await getDueManagementAccessPasswordSettings(query.location);
    return { settings };
  });

  app.put('/production-schedule-settings/due-management-access-password', { preHandler: canManage }, async (request) => {
    const body = dueManagementAccessPasswordBodySchema.parse(request.body);
    const settings = await upsertDueManagementAccessPassword({
      location: body.location,
      password: body.password
    });
    return { settings };
  });
}
