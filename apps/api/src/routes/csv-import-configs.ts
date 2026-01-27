import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../lib/auth.js';
import { CsvImportConfigService } from '../services/imports/csv-import-config.service.js';

const importTypeSchema = z.enum(['employees', 'items', 'measuringInstruments', 'riggingGears']);

const columnDefinitionSchema = z.object({
  internalName: z.string().min(1),
  displayName: z.string().min(1),
  csvHeaderCandidates: z.array(z.string().min(1)),
  dataType: z.enum(['string', 'number', 'date', 'boolean']),
  order: z.number().int().min(0),
  required: z.boolean().optional(),
});

const configUpsertSchema = z.object({
  enabled: z.boolean().optional().default(true),
  allowedManualImport: z.boolean().optional().default(true),
  allowedScheduledImport: z.boolean().optional().default(true),
  importStrategy: z.enum(['UPSERT', 'REPLACE']).optional().default('UPSERT'),
  columnDefinitions: z.array(columnDefinitionSchema).min(1),
});

export function registerCsvImportConfigRoutes(app: FastifyInstance): void {
  const mustBeAdmin = authorizeRoles('ADMIN');
  const service = new CsvImportConfigService();

  app.get('/csv-import-configs', { preHandler: mustBeAdmin }, async () => {
    const configs = await service.list();
    return { configs };
  });

  app.get('/csv-import-configs/:importType', { preHandler: mustBeAdmin }, async (request) => {
    const params = z.object({ importType: importTypeSchema }).parse(request.params);
    const config = await service.get(params.importType);
    return { config };
  });

  app.put('/csv-import-configs/:importType', { preHandler: mustBeAdmin }, async (request) => {
    const params = z.object({ importType: importTypeSchema }).parse(request.params);
    const body = configUpsertSchema.parse(request.body ?? {});
    const config = await service.upsert(params.importType, body);
    return { config };
  });
}
