import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import type { BackupConfig } from '../../services/backup/backup-config.js';
import { ProcedureMaterialService } from '../../services/assembly/procedure-material.service.js';
import { getProcedureMaterialGmailIngestionService, type ProcedureMaterialGmailIngestionService } from '../../services/assembly/procedure-material-gmail-ingestion.service.js';

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
  ingestion?: Pick<ProcedureMaterialGmailIngestionService, 'runOnce'>;
  loadConfig?: () => Promise<BackupConfig>;
}) {
  const service = options.service ?? new ProcedureMaterialService();
  const path = '/assembly/procedure-materials';
  app.get(path, { preHandler: options.allowView }, async (request) => ({ materials: await service.list(querySchema.parse(request.query)) }));
  app.get(`${path}/:id/file`, { preHandler: options.allowView }, async (request, reply) => {
    const file = await service.readFile(paramsSchema.parse(request.params).id);
    return reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').type(file.contentType).send(file.bytes);
  });
  app.post(`${path}/ingest-gmail`, { preHandler: options.allowWriteKiosk }, async (request) => {
    const body = ingestSchema.parse(request.body ?? {});
    const config = await (options.loadConfig ?? BackupConfigLoader.load)();
    return (options.ingestion ?? getProcedureMaterialGmailIngestionService()).runOnce({ config, allowWait: true, manual: true, ...body });
  });
  app.post(`${path}/gc`, { preHandler: options.allowWriteKiosk }, async () => (options.gc ?? new ProcedureMaterialGcService()).collect());
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
