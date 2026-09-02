import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { authorizeRoles } from '../../lib/auth.js';
import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { getWorkInstructionServices } from '../../services/work-instructions/work-instruction-service.factory.js';
import { normalizeWorkInstructionPartNumber } from '../../services/work-instructions/domain/normalization.js';
import type { WorkInstructionGmailIngestionService } from '../../services/work-instructions/work-instruction-gmail-ingestion.service.js';
import type { WorkInstructionReadService } from '../../services/work-instructions/work-instruction-read.service.js';
import type { WorkInstructionEditService } from '../../services/work-instructions/work-instruction-edit.service.js';
import { WorkInstructionPartAliasValidationError } from '../../services/work-instructions/domain/types.js';
import { registerWorkInstructionEditorRoutes } from './editor-routes.js';
import { toGroupDto, toGroupSummaryDto, toMessageDto, toRowDto } from './dto.js';

const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
const groupListQuerySchema = pageQuerySchema.extend({
  partNumber: z.string().trim().min(1).optional(),
  shootingTarget: z.string().trim().min(1).optional()
});
const groupQuerySchema = z.object({
  partNumber: z.string().trim().min(1),
  resource: z.string().trim().min(1)
});
const partCandidatesQuerySchema = pageQuerySchema.extend({
  prefix: z.string().trim().min(2).max(200),
  fallback: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .default(false)
    .transform((value) => value === true || value === 'true'),
  limit: z.coerce.number().int().min(1).max(20).default(20)
}).superRefine((value, context) => {
  if (value.fallback && value.offset !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['offset'], message: 'fallback requires offset 0' });
  }
});
const partAliasQuerySchema = z.object({ partNumber: z.string().trim().min(1).max(200) });
const partAliasBodySchema = z.object({
  scannedPartNumber: z.string().trim().min(1).max(200),
  canonicalPartNumber: z.string().trim().min(1).max(200)
});
const rowsQuerySchema = pageQuerySchema.extend({
  partNumber: z.string().trim().min(1).optional(),
  shootingTarget: z.string().trim().min(1).optional(),
  includeUnclassified: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .default(true)
    .transform((value) => value === true || value === 'true')
});
const messageQuerySchema = pageQuerySchema.extend({
  outcome: z.enum(['PENDING', 'PROCESSING', 'APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT', 'INVALID', 'RETRYABLE']).optional(),
  mailCleanupPending: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === undefined ? undefined : value === true || value === 'true')
});
const ingestBodySchema = z.object({ messageId: z.string().trim().min(1).optional() }).default({});

const authOnlyErrorCodes = new Set(['AUTH_TOKEN_REQUIRED', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED']);

function isAuthOnlyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: number; errorCode?: string };
  return value.statusCode === 401 && (value.errorCode == null || authOnlyErrorCodes.has(value.errorCode));
}

function isInsufficientPermissionsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: number; errorCode?: string; code?: string };
  return value.statusCode === 403
    && (value.errorCode ?? value.code) === 'AUTH_INSUFFICIENT_PERMISSIONS';
}

async function authorizeContentRead(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER', 'VIEWER']);
}

type WorkInstructionRouteServices = {
  ingestion: Pick<WorkInstructionGmailIngestionService, 'startJob' | 'getJob'>;
  read: WorkInstructionReadService;
  editing?: WorkInstructionEditService;
};

type WorkInstructionRouteOptions = {
  services?: WorkInstructionRouteServices;
  managePreHandler?: ReturnType<typeof authorizeRoles>;
  readPreHandler?: typeof authorizeContentRead;
  writePreHandler?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
};

export function registerWorkInstructionRoutes(
  app: FastifyInstance,
  options: WorkInstructionRouteOptions = {}
): void {
  const defaultServices = getWorkInstructionServices();
  const services = options.services ?? defaultServices;
  const canManage = options.managePreHandler ?? authorizeRoles('ADMIN', 'MANAGER');
  const canRead = options.readPreHandler ?? authorizeContentRead;
  const canWrite = options.writePreHandler ?? (async (request: FastifyRequest, reply: FastifyReply) => {
    const canWriteJwt = authorizeRoles('ADMIN', 'MANAGER');
    if (request.headers.authorization) {
      try {
        await canWriteJwt(request, reply);
        return;
      } catch (error) {
        // A kiosk request can carry a stale VIEWER JWT from a previous
        // session.  Preserve the endpoint's documented OR authorization
        // semantics by trying the client key when that JWT is valid but lacks
        // the write role.  Without a key, keep the original 403 response.
        const hasClientKey = Boolean(request.headers['x-client-key']);
        if (!isAuthOnlyError(error) && !(hasClientKey && isInsufficientPermissionsError(error))) throw error;
      }
    }
    await requireClientDevice(request.headers['x-client-key']);
    if (reply.statusCode === 401) reply.code(200);
  });

  app.post('/work-instructions/ingest', { preHandler: [canManage] }, async (request, reply) => {
    const body = ingestBodySchema.parse(request.body ?? {});
    const job = await services.ingestion.startJob({ messageId: body.messageId, allowWait: false });
    return reply.code(202).send({ jobId: job.id, status: job.status });
  });

  app.get('/work-instructions/ingest/jobs/:id', { preHandler: [canManage] }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const job = await services.ingestion.getJob(id);
    if (!job) throw new ApiError(404, '作業要領インポートジョブが見つかりません', undefined, 'WORK_INSTRUCTION_JOB_NOT_FOUND');
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      summary: job.summary,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null
    };
  });

  app.get('/work-instructions/ingest/messages', { preHandler: [canManage] }, async (request) => {
    const query = messageQuerySchema.parse(request.query ?? {});
    const messages = await services.read.readMessages({
      limit: query.limit,
      offset: query.offset,
      outcome: query.outcome,
      ...(query.mailCleanupPending === undefined ? {} : { mailCleanupPending: query.mailCleanupPending })
    });
    return { messages: messages.map(toMessageDto), limit: query.limit, offset: query.offset };
  });

  app.get('/work-instructions/groups', { preHandler: [canRead] }, async (request) => {
    const query = groupListQuerySchema.parse(request.query ?? {});
    const groups = await services.read.readPublishedGroups(query);
    return { groups: groups.map(toGroupSummaryDto), limit: query.limit, offset: query.offset };
  });

  app.get('/work-instructions/part-candidates', { preHandler: [canRead] }, async (request) => {
    const query = partCandidatesQuerySchema.parse(request.query ?? {});
    const page = await services.read.readPublishedPartCandidates(query);
    return { ...page, limit: query.limit, offset: query.offset };
  });

  app.get('/work-instructions/part-alias', { preHandler: [canRead] }, async (request) => {
    const query = partAliasQuerySchema.parse(request.query ?? {});
    const alias = await services.read.readPublishedPartAlias(query.partNumber);
    return {
      alias: alias ? {
        ...alias,
        createdAt: alias.createdAt.toISOString(),
        lastSelectedAt: alias.lastSelectedAt.toISOString()
      } : null
    };
  });

  app.put('/work-instructions/part-alias', { preHandler: [canWrite] }, async (request) => {
    const body = partAliasBodySchema.parse(request.body ?? {});
    const scannedPartNumber = normalizeWorkInstructionPartNumber(body.scannedPartNumber);
    const canonicalPartNumber = normalizeWorkInstructionPartNumber(body.canonicalPartNumber);
    if (!scannedPartNumber || !canonicalPartNumber) {
      throw new ApiError(400, '読取品番と正式品番を指定してください', undefined, 'WORK_INSTRUCTION_PART_ALIAS_INVALID');
    }
    const clientKey = request.headers['x-client-key'];
    let device: Awaited<ReturnType<typeof requireClientDevice>> | null = null;
    if (clientKey) {
      try {
        device = await requireClientDevice(clientKey);
      } catch (error) {
        // A valid ADMIN/MANAGER JWT is sufficient even when an unrelated or
        // stale client key is also present.  If the request was authorized by
        // the client key, canWrite has already validated it and this re-check
        // should still surface the same failure.
        if (!request.headers.authorization) throw error;
      }
    }
    let alias;
    try {
      alias = await services.read.upsertPartAlias({
        scannedPartNumber,
        canonicalPartNumber,
        lastSelectedClientDeviceId: device?.clientDevice.id ?? null
      });
    } catch (error) {
      if (error instanceof WorkInstructionPartAliasValidationError) {
        if (error.reason === 'EXACT_EXISTS') {
          throw new ApiError(
            409,
            '読取品番には公開中の作業要領書があるため類似登録できません',
            undefined,
            'WORK_INSTRUCTION_PART_ALIAS_EXACT_EXISTS'
          );
        }
        throw new ApiError(
          404,
          '選択した正式品番の公開作業要領書が見つかりません',
          undefined,
          'WORK_INSTRUCTION_PART_ALIAS_TARGET_NOT_FOUND'
        );
      }
      throw error;
    }
    return {
      alias: {
        ...alias,
        createdAt: alias.createdAt.toISOString(),
        lastSelectedAt: alias.lastSelectedAt.toISOString()
      }
    };
  });

  app.get('/work-instructions/group', { preHandler: [canRead] }, async (request) => {
    const query = groupQuerySchema.parse(request.query ?? {});
    const group = await services.read.readPublishedGroup({ partNumber: query.partNumber, shootingTarget: query.resource });
    if (!group) throw new ApiError(404, '作業要領グループが見つかりません', undefined, 'WORK_INSTRUCTION_GROUP_NOT_FOUND');
    return toGroupDto(group);
  });

  app.get('/work-instructions/rows', { preHandler: [canRead] }, async (request) => {
    const query = rowsQuerySchema.parse(request.query ?? {});
    const rows = await services.read.readRows(query);
    return { rows: rows.map(toRowDto), limit: query.limit, offset: query.offset };
  });

  app.get('/work-instructions/assets/:id', { preHandler: [canRead] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await services.read.readAsset(id);
    if (!result) throw new ApiError(404, '作業要領画像が見つかりません', undefined, 'WORK_INSTRUCTION_ASSET_NOT_FOUND');
    reply.header('Content-Type', result.asset.mimeType);
    reply.header('Content-Length', String(result.bytes.length));
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(result.bytes);
  });

  registerWorkInstructionEditorRoutes(app, {
    read: services.read,
    editing: services.editing ?? defaultServices.editing,
    allowView: canRead,
    allowWrite: canWrite
  });
}
