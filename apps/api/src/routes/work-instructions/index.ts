import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import { ApiError } from '../../lib/errors.js';
import { getWorkInstructionServices } from '../../services/work-instructions/work-instruction-service.factory.js';
import type { WorkInstructionGmailIngestionService } from '../../services/work-instructions/work-instruction-gmail-ingestion.service.js';
import type { WorkInstructionReadService } from '../../services/work-instructions/work-instruction-read.service.js';
import { toGroupDto, toGroupSummaryDto, toMessageDto, toRowDto } from './dto.js';

const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const groupListQuerySchema = pageQuerySchema.extend({
  partNumber: z.string().trim().min(1).optional(),
  shootingTarget: z.string().trim().min(1).optional(),
});

const groupQuerySchema = z.object({
  partNumber: z.string().trim().min(1),
  resource: z.string().trim().min(1),
});

const rowsQuerySchema = pageQuerySchema.extend({
  partNumber: z.string().trim().min(1).optional(),
  shootingTarget: z.string().trim().min(1).optional(),
  includeUnclassified: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .default(true)
    .transform((value) => value === true || value === 'true'),
});

const messageQuerySchema = pageQuerySchema.extend({
  outcome: z
    .enum(['PENDING', 'PROCESSING', 'APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT', 'INVALID', 'RETRYABLE'])
    .optional(),
  mailCleanupPending: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === undefined ? undefined : value === true || value === 'true'),
});

const ingestBodySchema = z.object({ messageId: z.string().trim().min(1).optional() }).default({});

async function authorizeContentRead(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER', 'VIEWER']);
}

type WorkInstructionRouteServices = {
  ingestion: Pick<WorkInstructionGmailIngestionService, 'startJob' | 'getJob'>;
  read: WorkInstructionReadService;
};

type WorkInstructionRouteOptions = {
  services?: WorkInstructionRouteServices;
  managePreHandler?: ReturnType<typeof authorizeRoles>;
  readPreHandler?: typeof authorizeContentRead;
};

export function registerWorkInstructionRoutes(
  app: FastifyInstance,
  options: WorkInstructionRouteOptions = {}
): void {
  const services = options.services ?? getWorkInstructionServices();
  const canManage = options.managePreHandler ?? authorizeRoles('ADMIN', 'MANAGER');
  const canRead = options.readPreHandler ?? authorizeContentRead;

  app.post('/work-instructions/ingest', { preHandler: [canManage] }, async (request, reply) => {
    const body = ingestBodySchema.parse(request.body ?? {});
    const job = await services.ingestion.startJob({
      messageId: body.messageId,
      allowWait: false,
    });
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
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    };
  });

  app.get('/work-instructions/ingest/messages', { preHandler: [canManage] }, async (request) => {
    const query = messageQuerySchema.parse(request.query ?? {});
    const messages = await services.read.readMessages({
      limit: query.limit,
      offset: query.offset,
      outcome: query.outcome,
      ...(query.mailCleanupPending === undefined
        ? {}
        : { mailCleanupPending: query.mailCleanupPending }),
    });
    return { messages: messages.map(toMessageDto), limit: query.limit, offset: query.offset };
  });

  app.get('/work-instructions/groups', { preHandler: [canRead] }, async (request) => {
    const query = groupListQuerySchema.parse(request.query ?? {});
    const groups = await services.read.readGroups(query);
    return { groups: groups.map(toGroupSummaryDto), limit: query.limit, offset: query.offset };
  });

  app.get('/work-instructions/group', { preHandler: [canRead] }, async (request) => {
    const query = groupQuerySchema.parse(request.query ?? {});
    const group = await services.read.readGroup({
      partNumber: query.partNumber,
      shootingTarget: query.resource,
    });
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

}
