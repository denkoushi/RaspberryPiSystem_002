import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../lib/errors.js';
import { requireKioskClientDevice } from '../services/clients/client-device-auth.service.js';
import { requireProcedureBoardEnabled } from '../services/mobile-placement/client-capabilities.service.js';
import { getKnowledgeRuntime } from '../services/knowledge/knowledge-runtime.js';

const pageQuery = z.object({ cursor: z.string().min(1).max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).strict();
const paramsSchema = z.object({ procedureId: z.string().min(1).max(200) });

export function registerKioskProcedureBoardRoutes(app: FastifyInstance) {
  app.register(async boardApp => {
    boardApp.addHook('onRequest', async request => {
      const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
      await requireProcedureBoardEnabled(clientDevice.id);
      if (process.env.HERMES_KNOWLEDGE_ENABLED !== 'true') throw new ApiError(403, '手順づくりは無効です', undefined, 'PROCEDURE_BOARD_FORBIDDEN');
    });
    const clientId = async (key: unknown) => (await requireKioskClientDevice(key)).clientDevice.id;
    const repository = () => getKnowledgeRuntime().procedureBoards.repository;
    boardApp.get('/procedures', async request => {
      const query = pageQuery.parse(request.query);
      return repository().listProcedures(query.cursor, query.limit);
    });
    boardApp.post('/:procedureId', async (request, reply) => {
      const { procedureId } = paramsSchema.parse(request.params); z.object({}).strict().parse(request.body);
      const { created, ...board } = await repository().getOrCreate(procedureId, await clientId(request.headers['x-client-key']));
      return reply.code(created ? 201 : 200).send(board);
    });
    boardApp.get('/:procedureId/materials', async request => {
      const { procedureId } = paramsSchema.parse(request.params); const query = pageQuery.parse(request.query);
      return repository().materials(procedureId, query.cursor, query.limit);
    });
    boardApp.get('/:procedureId/materials/:materialId/images/:imageId', async (request, reply) => {
      const { procedureId, materialId, imageId } = paramsSchema.extend({ materialId: z.string().min(1).max(200), imageId: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(request.params);
      await repository().image(procedureId, materialId, imageId);
      return reply.type('image/jpeg').send(await getKnowledgeRuntime().assets.readDisplay(imageId));
    });
    boardApp.get('/:procedureId', async request => repository().get(paramsSchema.parse(request.params).procedureId, await clientId(request.headers['x-client-key'])));
    boardApp.put('/:procedureId', { bodyLimit: 10_000_000 }, async request => getKnowledgeRuntime().procedureBoards.save(
      paramsSchema.parse(request.params).procedureId, await clientId(request.headers['x-client-key']), request.body));
    boardApp.post('/:procedureId/events', async request => getKnowledgeRuntime().procedureBoards.events(
      paramsSchema.parse(request.params).procedureId, await clientId(request.headers['x-client-key']), request.body));
    boardApp.get('/:procedureId/suggestions', async request => repository().suggestions(
      paramsSchema.parse(request.params).procedureId, await clientId(request.headers['x-client-key'])));
    boardApp.post('/:procedureId/suggestions/:suggestionId/decisions', async request => {
      const { procedureId, suggestionId } = paramsSchema.extend({ suggestionId: z.string().min(1).max(200) }).parse(request.params);
      return getKnowledgeRuntime().procedureBoards.decidePlacement(procedureId, await clientId(request.headers['x-client-key']), suggestionId, request.body);
    });
    boardApp.post('/:procedureId/format-proposals', async (request, reply) => reply.code(202).send(
      await getKnowledgeRuntime().procedureBoards.requestFormat(paramsSchema.parse(request.params).procedureId, await clientId(request.headers['x-client-key']), request.body)));
    boardApp.get('/:procedureId/format-proposals/:proposalId', async request => {
      const { procedureId, proposalId } = paramsSchema.extend({ proposalId: z.string().min(1).max(200) }).parse(request.params);
      return repository().formatProposal(procedureId, proposalId, await clientId(request.headers['x-client-key']));
    });
    boardApp.post('/:procedureId/format-proposals/:proposalId/decision', async request => {
      const { procedureId, proposalId } = paramsSchema.extend({ proposalId: z.string().min(1).max(200) }).parse(request.params);
      return getKnowledgeRuntime().procedureBoards.decideFormat(procedureId, await clientId(request.headers['x-client-key']), proposalId, request.body);
    });
    boardApp.put('/:procedureId/trial', async request => {
      const { expectedVersion, startedAt } = z.object({ expectedVersion: z.number().int().positive(), startedAt: z.string().datetime({ offset: true }) }).strict().parse(request.body);
      return repository().startTrial(paramsSchema.parse(request.params).procedureId, await clientId(request.headers['x-client-key']), expectedVersion, new Date(startedAt));
    });
    boardApp.get('/:procedureId/metrics', async request => {
      const { trialStart, weeks } = z.object({ trialStart: z.string().datetime({ offset: true }), weeks: z.coerce.number().int().min(1).max(52).default(4) }).strict().parse(request.query);
      return repository().weeklyMetrics(paramsSchema.parse(request.params).procedureId, new Date(trialStart), weeks);
    });
  }, { prefix: '/kiosk/procedure-boards' });
}
