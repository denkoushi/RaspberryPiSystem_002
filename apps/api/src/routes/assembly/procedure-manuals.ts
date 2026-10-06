import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { ProcedureManualService } from '../../services/assembly/procedure-manual.service.js';
import type { AssemblyProcedureSequence } from '../../services/assembly/assembly-procedure-sequence.service.js';
import { normalizeMachineNameForCompare } from '../../services/production-schedule/machine-name-compare.js';

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
  serializeSequence: (sequence: AssemblyProcedureSequence) => unknown;
}) {
  const service = options.service ?? new ProcedureManualService();
  app.get('/assembly/procedure-manuals/processes', { preHandler: options.allowView }, async () => ({ processes: await service.listProcesses() }));
  app.get('/assembly/procedure-manuals/models', { preHandler: options.allowView }, async () => ({ models: await service.listModels() }));
  app.get('/assembly/procedure-manuals/models/:modelCodeKey/overview', { preHandler: options.allowView }, async (request) => {
    const params = paramsSchema.pick({ modelCodeKey: true }).parse(request.params);
    return service.getModelOverview(params.modelCodeKey);
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
    const key = normalizeMachineNameForCompare(body.modelCode).trim();
    if (!key || key !== normalizeMachineNameForCompare(params.modelCodeKey).trim()) {
      throw new ApiError(400, '型番が不正です');
    }
    await service.replaceAssignments(body.modelCode, params.processId, body.assignments);
    return { saved: true };
  });
}
