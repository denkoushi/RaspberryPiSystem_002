import { DomainHttpError } from '../../lib/errors.js';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod/v3';
import {
  AssemblyLibraryFilterOptionsService,
  AssemblyMachineNameCandidatesService,
  AssemblySeibanLotQuantityService,
  AssemblySeibanStartService,
  AssemblyTemplateService,
  resolveAssemblyOperatorNfcUid,
  type AssemblyTemplateAreaInput,
  type AssemblyTemplateCheckItemInput
} from '../../services/assembly/index.js';
import {
  optionalTrueOnlyBooleanSchema,
  idParamSchema,
  machineNameCandidatesQuerySchema,
  templateBodySchema,
  templateReviseBodySchema
} from './schemas.js';
import { serializeTemplateSummary, serializeSeibanCandidate, serializeTemplate } from './serializers.js';

export function registerAssemblyCandidateRoutes(app: FastifyInstance, {
  allowView,
  libraryFilterOptionsService,
  machineNameCandidatesService,
  seibanStartService,
  seibanLotQuantityService
}: {
  allowView: preHandlerHookHandler;
  libraryFilterOptionsService: AssemblyLibraryFilterOptionsService;
  machineNameCandidatesService: AssemblyMachineNameCandidatesService;
  seibanStartService: AssemblySeibanStartService;
  seibanLotQuantityService: AssemblySeibanLotQuantityService;
}): void {
  app.get('/assembly/machine-name-candidates', { preHandler: allowView }, async (request) => {
    const query = machineNameCandidatesQuerySchema.parse(request.query);
    return machineNameCandidatesService.list(query);
  });

  app.get('/assembly/seiban-candidates', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        prefix: z.string().trim().min(1).max(120),
        limit: z.coerce.number().int().min(1).max(50).optional()
      })
      .parse(request.query);
    const candidates = await seibanStartService.listSeibanCandidates(q);
    return { candidates: candidates.map(serializeSeibanCandidate) };
  });

  app.get('/assembly/seiban-lot-quantities', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        productNos: z.string().trim().min(1).max(4000)
      })
      .parse(request.query);
    const productNos = q.productNos
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .slice(0, 100);
    const items = await seibanLotQuantityService.listByProductNos(productNos);
    return { items };
  });

  app.post('/assembly/operators/resolve-nfc', { preHandler: allowView }, async (request) => {
    const body = z.object({ uid: z.string().trim().min(1).max(200) }).parse(request.body);
    const resolved = await resolveAssemblyOperatorNfcUid(body.uid);
    if (!resolved) throw new DomainHttpError(404, '社員タグが見つかりません');
    return resolved;
  });

  app.get('/assembly/library/filter-options', { preHandler: allowView }, async (request) => {
    const query = z
      .object({
        field: z.enum(['templateModelCode', 'templateProcedureDocumentName', 'procedureDocumentName']),
        q: z.string().trim().max(200).optional(),
        includeInactive: optionalTrueOnlyBooleanSchema,
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query);
    const options = await libraryFilterOptionsService.list(query);
    return { options };
  });
}

export function registerAssemblyTemplateRoutes(app: FastifyInstance, {
  allowView,
  allowWriteKiosk,
  templateService
}: {
  allowView: preHandlerHookHandler;
  allowWriteKiosk: preHandlerHookHandler;
  templateService: AssemblyTemplateService;
}): void {
  app.get('/assembly/templates', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        includeInactive: optionalTrueOnlyBooleanSchema,
        modelCode: z.string().optional(),
        procedurePattern: z.string().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional()
      })
      .parse(request.query);
    const templates = await templateService.list(q);
    return { templates: templates.map(serializeTemplate) };
  });

  app.get('/assembly/templates/summary', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        includeInactive: optionalTrueOnlyBooleanSchema,
        modelCode: z.string().optional(),
        procedurePattern: z.string().optional(),
        procedureDocumentId: z.string().uuid().optional(),
        procedureDocumentName: z.string().optional(),
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional()
      })
      .parse(request.query);
    const templates = await templateService.listSummary(q);
    return { templates: templates.map(serializeTemplateSummary) };
  });

  app.get('/assembly/templates/:id', { preHandler: allowView }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const template = await templateService.getById(params.id, { includeInactive: true });
    if (!template) throw new DomainHttpError(404, 'テンプレートが見つかりません');
    return { template: serializeTemplate(template) };
  });

  app.post('/assembly/templates', { preHandler: allowWriteKiosk }, async (request) => {
    const body = templateBodySchema.parse(request.body);
    const template = await templateService.create({
      ...body,
      areas: body.areas as AssemblyTemplateAreaInput[],
      checkItems: body.checkItems as AssemblyTemplateCheckItemInput[] | undefined
    });
    return { template: serializeTemplate(template) };
  });

  app.post('/assembly/templates/:id/revise', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = templateReviseBodySchema.parse(request.body);
    const template = await templateService.revise(params.id, {
      ...body,
      areas: body.areas as AssemblyTemplateAreaInput[] | undefined,
      checkItems: body.checkItems as AssemblyTemplateCheckItemInput[] | undefined
    });
    return { template: serializeTemplate(template) };
  });

  app.delete('/assembly/templates/:id', { preHandler: allowWriteKiosk }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const result = await templateService.retire(params.id);
    if (result === 'not_found') throw new DomainHttpError(404, 'テンプレートが見つかりません');
    return reply.status(204).send();
  });
}
