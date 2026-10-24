import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod/v3';
import { AssemblyTraceabilityService } from '../../services/assembly/index.js';
import { idParamSchema } from './schemas.js';
import { dateToIso } from './serializers.js';
import { buildAssemblyTraceabilityActor } from './shared.js';

export function registerAssemblyTraceabilityRoutes(app: FastifyInstance, {
  allowView,
  allowWriteKiosk,
  assemblyTraceabilityService
}: {
  allowView: preHandlerHookHandler;
  allowWriteKiosk: preHandlerHookHandler;
  assemblyTraceabilityService: AssemblyTraceabilityService;
}): void {
  app.get('/assembly/traceability/work-units', { preHandler: allowView }, async (request) => {
    const query = z
      .object({
        scope: z.literal('top_level').optional(),
        state: z.enum(['all', 'unassigned', 'assigned']).optional(),
        query: z.string().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query);
    const workUnits = await assemblyTraceabilityService.listTopLevelCompleted(query);
    const filtered = query.state === 'unassigned'
      ? workUnits.filter((unit) => unit.formalIdentifier == null)
      : query.state === 'assigned'
        ? workUnits.filter((unit) => unit.formalIdentifier != null)
        : workUnits;
    return {
      workUnits: filtered.map((unit) => ({
        ...unit,
        completedAt: dateToIso(unit.completedAt),
        formalIdentifier: unit.formalIdentifier
          ? { ...unit.formalIdentifier, assignedAt: unit.formalIdentifier.assignedAt.toISOString() }
          : null
      }))
    };
  });

  app.post('/assembly/traceability/work-units/resolve', { preHandler: allowView }, async (request) => {
    const body = z.object({ workId: z.string().trim().min(1).max(120) }).parse(request.body);
    return assemblyTraceabilityService.resolve(body.workId);
  });

  app.post('/assembly/traceability/links', { preHandler: allowWriteKiosk }, async (request) => {
    const body = z.object({
      parentWorkId: z.string().trim().min(1).max(120),
      childWorkId: z.string().trim().min(1).max(120),
      accessPassword: z.string().max(128).optional().default('')
    }).parse(request.body);
    const link = await assemblyTraceabilityService.link({ ...body, actor: await buildAssemblyTraceabilityActor(request) });
    return { link };
  });

  app.post('/assembly/traceability/links/:id/unlink', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({ accessPassword: z.string().max(128).optional().default(''), reason: z.string().trim().min(1).max(500) }).parse(request.body);
    const link = await assemblyTraceabilityService.unlink({ linkId: params.id, ...body, actor: await buildAssemblyTraceabilityActor(request) });
    return { link };
  });

  app.post('/assembly/traceability/links/:id/reassign', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({
      parentWorkId: z.string().trim().min(1).max(120),
      accessPassword: z.string().max(128).optional().default(''),
      reason: z.string().trim().min(1).max(500)
    }).parse(request.body);
    const link = await assemblyTraceabilityService.reassign({ linkId: params.id, ...body, actor: await buildAssemblyTraceabilityActor(request) });
    return { link };
  });

  app.post('/assembly/traceability/formal-identifiers', { preHandler: allowWriteKiosk }, async (request) => {
    const body = z.object({
      workId: z.string().trim().min(1).max(120),
      formalId: z.string().trim().min(1).max(120),
      accessPassword: z.string().max(128).optional().default('')
    }).parse(request.body);
    const formalIdentifier = await assemblyTraceabilityService.assignFormalIdentifier({ ...body, actor: await buildAssemblyTraceabilityActor(request) });
    return { formalIdentifier };
  });

  app.post('/assembly/traceability/formal-identifiers/:id/correct', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({
      formalId: z.string().trim().min(1).max(120),
      accessPassword: z.string().max(128).optional().default(''),
      reason: z.string().trim().min(1).max(500)
    }).parse(request.body);
    const formalIdentifier = await assemblyTraceabilityService.correctFormalIdentifier({
      assignmentId: params.id,
      ...body,
      actor: await buildAssemblyTraceabilityActor(request)
    });
    return { formalIdentifier };
  });
}
