import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import { HermesSearchTrialService } from '../../services/assembly/hermes-search-trial.service.js';

export async function registerHermesSearchTrialRoutes(app: FastifyInstance, service = new HermesSearchTrialService()) {
  const preHandler = async (request: Parameters<typeof authorizeKioskClientKeyOrJwtRoles>[0], reply: Parameters<typeof authorizeKioskClientKeyOrJwtRoles>[1]) => {
    await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN','MANAGER','VIEWER']);
  };
  app.get('/assembly/hermes-search-trial/scope', {preHandler}, async (_request,reply) => {
    try { return await service.scope(); }
    catch { return reply.code(503).send({code:'HERMES_SEARCH_UNAVAILABLE',message:'試用検索を利用できません。'}); }
  });
  app.post('/assembly/hermes-search-trial/answer', {preHandler,config:{rateLimit:{max:12,timeWindow:'1 minute'}}}, async (request,reply) => {
    const {question} = z.object({question:z.string().trim().min(1).max(4000)}).strict().parse(request.body);
    if (!service.isEnabled()) return reply.code(503).send({code:'HERMES_SEARCH_DISABLED',message:'試用検索は無効です。'});
    try { return await service.answer(question); }
    catch (error) { return reply.code(503).send({code:'HERMES_SEARCH_UNAVAILABLE',message:error instanceof Error?error.message:'検索に失敗しました。'}); }
  });
  app.addHook('onClose',async()=>service.close());
}
