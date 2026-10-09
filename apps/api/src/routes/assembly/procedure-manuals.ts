import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { ProcedureManualPartCandidatesService } from '../../services/assembly/procedure-manual-part-candidates.service.js';
import { ProcedureManualService } from '../../services/assembly/procedure-manual.service.js';
import type { AssemblyProcedureSequence } from '../../services/assembly/assembly-procedure-sequence.service.js';

const paramsSchema = z.object({ modelCodeKey: z.string().min(1).max(200), processId: z.string().min(1).max(200) });
const bodySchema = z.object({
  modelCode: z.string().min(1).max(200),
  assignments: z.array(z.object({
    kioskDocumentId: z.string().uuid().nullish(),
    assemblyProcedureDocumentId: z.string().uuid().nullish(),
    sortOrder: z.number().int().min(0),
    label: z.string().trim().max(200).nullish()
  }).refine((item) => Boolean(item.kioskDocumentId) !== Boolean(item.assemblyProcedureDocumentId), '文書はどちらか一方を指定してください')).max(200)
});

export function registerProcedureManualRoutes(app: FastifyInstance, options: {
  allowView: preHandlerHookHandler;
  allowWriteKiosk: preHandlerHookHandler;
  service?: ProcedureManualService;
  partCandidatesService?: ProcedureManualPartCandidatesService;
  serializeSequence: (sequence: AssemblyProcedureSequence) => unknown;
}) {
  const service = options.service ?? new ProcedureManualService();
  const partCandidatesService = options.partCandidatesService ?? new ProcedureManualPartCandidatesService();
  app.get('/assembly/procedure-manuals/part-candidates', { preHandler: options.allowView }, async (request) => {
    const query = z.object({
      digitQuery: z.string().regex(/^[0-9]*$/, 'digitQueryは半角数字のみ指定できます').max(120).optional(),
      q: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }).parse(request.query);
    return { parts: await partCandidatesService.list(query) };
  });
  app.get('/assembly/procedure-manuals/processes', { preHandler: options.allowView }, async () => ({ processes: await service.listProcesses() }));
  app.get('/assembly/procedure-manuals/parts', { preHandler: options.allowView }, async () => ({ parts: await service.listParts() }));
  app.get('/assembly/procedure-manuals/models', { preHandler: options.allowView }, async () => ({ models: await service.listModels() }));
  app.get('/assembly/procedure-manuals/overview', { preHandler: options.allowView }, async (request) => {
    const query = paramsSchema.pick({ processId: true }).partial().extend({
      published: z.enum(['true', 'false']).optional()
    }).parse(request.query);
    return service.getOverview(query.processId, query.published === 'true');
  });
  app.get('/assembly/procedure-manuals/models/:modelCodeKey/overview', { preHandler: options.allowView }, async (request) => {
    const params = paramsSchema.pick({ modelCodeKey: true }).parse(request.params);
    return service.getModelOverview(params.modelCodeKey);
  });
  app.get('/assembly/procedure-manuals/by-part', { preHandler: options.allowView }, async (request) => {
    const { partNumber } = z.object({ partNumber: z.string().trim().min(1).max(200) }).parse(request.query);
    const result = await service.getByPart(partNumber);
    return { ...result, processes: result.processes.map(process => ({ ...process, sequence: options.serializeSequence(process.sequence) })) };
  });
  const path = '/assembly/procedure-manuals/models/:modelCodeKey/processes/:processId';
  app.get(path, { preHandler: options.allowView }, async (request) => {
    const params = paramsSchema.parse(request.params);
    const result = await service.getAssignments(params.modelCodeKey, params.processId);
    return { assignments: result.assignments, sequence: options.serializeSequence(result.sequence) };
  });
  app.put(path, { preHandler: options.allowWriteKiosk }, async (request) => {
    const params = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const key = await service.normalizeSubjectKey(body.modelCode, params.processId);
    if (!key || key !== await service.normalizeSubjectKey(params.modelCodeKey, params.processId)) {
      throw new ApiError(400, '型番または品番が不正です');
    }
    await service.replaceAssignments(body.modelCode, params.processId, body.assignments);
    return { saved: true };
  });
}
