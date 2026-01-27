import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../lib/auth.js';
import { CsvImportSubjectPatternService } from '../services/imports/csv-import-subject-pattern.service.js';

const importTypeSchema = z.enum([
  'employees',
  'items',
  'measuringInstruments',
  'riggingGears',
  'csvDashboards',
]);

const createSchema = z.object({
  importType: importTypeSchema,
  dashboardId: z.string().uuid().optional().nullable(),
  pattern: z.string().trim().min(1),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.importType === 'csvDashboards' && !data.dashboardId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dashboardId'],
      message: 'csvDashboardsの場合はdashboardIdが必須です',
    });
  }
});

const updateSchema = z.object({
  pattern: z.string().trim().min(1).optional(),
  priority: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

const reorderSchema = z.object({
  importType: importTypeSchema,
  dashboardId: z.string().uuid().optional().nullable(),
  orderedIds: z.array(z.string().min(1)).min(1),
}).superRefine((data, ctx) => {
  if (data.importType === 'csvDashboards' && !data.dashboardId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dashboardId'],
      message: 'csvDashboardsの場合はdashboardIdが必須です',
    });
  }
});

export function registerCsvImportSubjectPatternRoutes(app: FastifyInstance): void {
  const mustBeAdmin = authorizeRoles('ADMIN');
  const service = new CsvImportSubjectPatternService();

  // GET /api/csv-import-subject-patterns
  app.get('/csv-import-subject-patterns', { preHandler: mustBeAdmin }, async (request) => {
    const query = request.query as { importType?: string; dashboardId?: string };
    const dashboardId = query.dashboardId ? z.string().uuid().parse(query.dashboardId) : undefined;
    const importType = query.importType
      ? importTypeSchema.parse(query.importType)
      : dashboardId
        ? 'csvDashboards'
        : undefined;
    const patterns = await service.list(importType, dashboardId);
    return { patterns };
  });

  // POST /api/csv-import-subject-patterns
  app.post('/csv-import-subject-patterns', { preHandler: mustBeAdmin }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const pattern = await service.create(body);
    reply.code(201);
    return { pattern };
  });

  // PUT /api/csv-import-subject-patterns/:id
  app.put('/csv-import-subject-patterns/:id', { preHandler: mustBeAdmin }, async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = updateSchema.parse(request.body ?? {});
    const pattern = await service.update(params.id, body);
    return { pattern };
  });

  // DELETE /api/csv-import-subject-patterns/:id
  app.delete('/csv-import-subject-patterns/:id', { preHandler: mustBeAdmin }, async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    await service.delete(params.id);
    return { success: true };
  });

  // POST /api/csv-import-subject-patterns/reorder
  app.post('/csv-import-subject-patterns/reorder', { preHandler: mustBeAdmin }, async (request) => {
    const body = reorderSchema.parse(request.body ?? {});
    const patterns = await service.reorder(body.importType, body.orderedIds, body.dashboardId ?? undefined);
    return { patterns };
  });
}
