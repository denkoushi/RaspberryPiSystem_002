import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { AssemblyProcedureDocumentEditLeaseService, ASSEMBLY_PROCEDURE_EDIT_LOCKED } from '../../services/assembly/assembly-procedure-document-edit-lease.service.js';
import { findClientDeviceByApiKey, parseKioskApiClientKeyHeader } from '../../services/clients/client-device-auth.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
export function readAssemblyProcedureEditToken(request: FastifyRequest) {
  const token = request.headers['x-procedure-edit-token'];
  return typeof token === 'string' ? token : null;
}

export async function resolveAssemblyProcedureEditWriter(request: FastifyRequest) {
  const actor = await resolveAssemblyProcedureEditActor(request);
  return { holderKey: actor?.holderKey ?? null, holderToken: readAssemblyProcedureEditToken(request) };
}

const service = new AssemblyProcedureDocumentEditLeaseService();

export async function resolveAssemblyProcedureEditActor(request: FastifyRequest) {
  if (request.user) return { holderKey: `user:${request.user.id}`, holderLabel: request.user.username };
  const key = parseKioskApiClientKeyHeader(request.headers['x-client-key']);
  const client = key ? await findClientDeviceByApiKey(key) : null;
  return client ? { holderKey: `client:${client.id}`, holderLabel: client.name } : null;
}

function sendLocked(error: unknown, reply: FastifyReply) {
  if (!(error instanceof ApiError) || error.code !== ASSEMBLY_PROCEDURE_EDIT_LOCKED) throw error;
  const details = error.details as { lease: unknown };
  return reply.status(409).send({ code: ASSEMBLY_PROCEDURE_EDIT_LOCKED, message: error.message, lease: details.lease });
}

export const enforceAssemblyProcedureEditLease: preHandlerHookHandler = async (request, reply) => {
  const { id } = idParamsSchema.parse(request.params);
  const actor = await resolveAssemblyProcedureEditActor(request);
  try {
    await service.assertCanWrite(id, actor?.holderKey ?? null, undefined, readAssemblyProcedureEditToken(request));
  } catch (error) {
    return sendLocked(error, reply);
  }
};

export function registerAssemblyProcedureDocumentEditLeaseRoutes(app: FastifyInstance, options: { allowWriteKiosk: preHandlerHookHandler }) {
  app.post('/assembly/procedure-documents/:id/edit-lease', { preHandler: options.allowWriteKiosk }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { takeover } = z.object({ takeover: z.boolean().optional() }).strict().parse(request.body ?? {});
    const actor = await resolveAssemblyProcedureEditActor(request);
    if (!actor) throw new ApiError(401, '認証が必要です');
    try {
      return await service.acquire(id, actor, takeover, readAssemblyProcedureEditToken(request));
    } catch (error) {
      return sendLocked(error, reply);
    }
  });
  app.delete('/assembly/procedure-documents/:id/edit-lease', { preHandler: options.allowWriteKiosk }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const actor = await resolveAssemblyProcedureEditActor(request);
    if (!actor) throw new ApiError(401, '認証が必要です');
    await service.release(id, actor.holderKey, readAssemblyProcedureEditToken(request));
    return reply.status(204).send();
  });
}
