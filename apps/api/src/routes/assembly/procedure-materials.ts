import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { ProcedureMaterialService } from '../../services/assembly/procedure-material.service.js';
import { getProcedureMaterialGmailIngestionService, type ProcedureMaterialGmailIngestionService } from '../../services/assembly/procedure-material-gmail-ingestion.service.js';

import { ProcedureMaterialKnowledgeService } from '../../services/assembly/procedure-material-knowledge.service.js';
import { ProcedureMaterialWorkInstructionService } from '../../services/assembly/procedure-material-work-instruction.service.js';

import { ProcedureMaterialGcService } from '../../services/assembly/procedure-material-gc.service.js';

const querySchema = z.object({
  state: z.enum(['unplaced', 'placed', 'discarded', 'all']).default('unplaced'),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const paramsSchema = z.object({ id: z.string().uuid() });
const ingestSchema = z.object({ messageId: z.string().min(1).max(200).optional(), forceRetry: z.boolean().optional() });

export function registerProcedureMaterialRoutes(app: FastifyInstance, options: {
  allowView: preHandlerHookHandler; allowWriteKiosk: preHandlerHookHandler;
  service?: ProcedureMaterialService;
  gc?: ProcedureMaterialGcService;
  knowledge?: ProcedureMaterialKnowledgeService;
  workInstructions?: ProcedureMaterialWorkInstructionService;
  ingestion?: Pick<ProcedureMaterialGmailIngestionService, 'runOnce'>;
  loadConfig?: () => Promise<BackupConfig>;
}) {
  const service = options.service ?? new ProcedureMaterialService();
  const path = '/assembly/procedure-materials';
  const knowledge = options.knowledge ?? new ProcedureMaterialKnowledgeService();
  const workInstructions = options.workInstructions ?? new ProcedureMaterialWorkInstructionService();
  app.get(`${path}/work-instruction-candidates`, { preHandler: options.allowView }, async (request) =>
    workInstructions.list(querySchema.pick({ q: true, limit: true }).extend({ limit: z.coerce.number().int().min(1).max(200).default(60) }).parse(request.query)));
  app.post(`${path}/import-work-instructions`, { preHandler: options.allowWriteKiosk }, async (request) => {
    const { items } = z.object({ items: z.array(z.object({
      candidateKey: z.string().min(1).max(500),
      partNumber: z.string().trim().min(1).max(200),
      shootingTarget: z.string().trim().min(1).max(200),
    }).strict()).min(1).max(50) }).strict().parse(request.body);
    return workInstructions.import(items);
  });
  app.get(`${path}/knowledge-candidates`, { preHandler: options.allowView }, async (request) =>
    knowledge.list(querySchema.pick({ q: true, limit: true }).extend({ limit: z.coerce.number().int().min(1).max(300).default(100) }).parse(request.query)));
  app.get(`${path}/knowledge-candidates/images/:imageId`, { preHandler: options.allowView, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { imageId } = z.object({ imageId: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.params);
    return reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').type('image/jpeg').send(await knowledge.readImage(imageId));
  });
  app.post(`${path}/import-knowledge`, { preHandler: options.allowWriteKiosk }, async (request) => {
    const { candidateKeys } = z.object({ candidateKeys: z.array(z.string().min(1).max(500)).min(1).max(50) }).strict().parse(request.body);
    return knowledge.import(candidateKeys);
  });
  app.get(path, { preHandler: options.allowView }, async (request) => ({ materials: await service.list(querySchema.parse(request.query)) }));
  app.get(`${path}/:id/file`, { preHandler: options.allowView, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const file = await service.readFile(paramsSchema.parse(request.params).id);
    return reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').type(file.contentType).send(file.bytes);
  });
  app.post(`${path}/ingest-gmail`, { preHandler: options.allowWriteKiosk }, async (request) => {
    const body = ingestSchema.parse(request.body ?? {});
    // Call the static loader as a method; a detached reference loses `this` and throws.
    const config = options.loadConfig ? await options.loadConfig() : await BackupConfigLoader.load();
    return (options.ingestion ?? getProcedureMaterialGmailIngestionService()).runOnce({ config, allowWait: true, manual: true, ...body });
  });
  app.post(`${path}/gc`, { preHandler: options.allowWriteKiosk, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async () => (options.gc ?? new ProcedureMaterialGcService()).collect());
  app.post(`${path}/:id/create-document`, { preHandler: options.allowWriteKiosk }, async (request) =>
    service.createDocument(paramsSchema.parse(request.params).id));
  app.post(`${path}/:id/unplace`, { preHandler: options.allowWriteKiosk }, async (request) => {
    await service.unplace(paramsSchema.parse(request.params).id);
    return { saved: true };
  });
  for (const action of ['discard', 'restore'] as const) {
    app.post(`${path}/:id/${action}`, { preHandler: options.allowWriteKiosk }, async (request) => {
      await service.setDiscarded(paramsSchema.parse(request.params).id, action === 'discard');
      return { saved: true };
    });
  }
}
