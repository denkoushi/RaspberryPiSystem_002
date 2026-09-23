import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import { HermesSearchTrialService } from '../../services/assembly/hermes-search-trial.service.js';

const SAFE_DIAGNOSTIC_STAGES = new Set(['jev_query', 'worker_request']);
const SAFE_DIAGNOSTIC_EXCEPTION_TYPES = new Set(['TypeSafeDirectError', 'AbortError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'Error']);
const SAFE_DIAGNOSTIC_CODES = new Set([
  'missing_credentials', 'transport_unavailable', 'upstream_http', 'invalid_json',
  'invalid_answers', 'timeout', 'connection_failed', 'unclassified',
]);

function safeWorkerFailureDiagnostic(error: unknown) {
  if (!error || typeof error !== 'object' || !('workerFailureDiagnostic' in error)) return null;
  const value = error.workerFailureDiagnostic;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const diagnostic = value as Record<string, unknown>;
  if (typeof diagnostic.stage !== 'string' || !SAFE_DIAGNOSTIC_STAGES.has(diagnostic.stage)
    || typeof diagnostic.exceptionType !== 'string' || !SAFE_DIAGNOSTIC_EXCEPTION_TYPES.has(diagnostic.exceptionType)
    || typeof diagnostic.failureCode !== 'string' || !SAFE_DIAGNOSTIC_CODES.has(diagnostic.failureCode)) return null;
  if (diagnostic.stage === 'jev_query') {
    if (diagnostic.exceptionType !== 'TypeSafeDirectError' || diagnostic.provider !== 'typesafe-direct'
      || diagnostic.failureCode === 'unclassified') return null;
    if (diagnostic.failureCode === 'upstream_http'
      && (!Number.isInteger(diagnostic.httpStatus) || Number(diagnostic.httpStatus) < 100 || Number(diagnostic.httpStatus) > 599)) return null;
    return {
      stage: diagnostic.stage,
      exceptionType: diagnostic.exceptionType,
      provider: 'typesafe-direct',
      failureCode: diagnostic.failureCode,
      ...(diagnostic.failureCode === 'upstream_http' ? { httpStatus: diagnostic.httpStatus } : {}),
    };
  }
  if (diagnostic.failureCode !== 'unclassified' || diagnostic.provider !== undefined || diagnostic.httpStatus !== undefined) return null;
  return { stage: diagnostic.stage, exceptionType: diagnostic.exceptionType, failureCode: 'unclassified' };
}

export async function registerHermesSearchTrialRoutes(app: FastifyInstance, service = new HermesSearchTrialService()) {
  const preHandler = async (request: Parameters<typeof authorizeKioskClientKeyOrJwtRoles>[0], reply: Parameters<typeof authorizeKioskClientKeyOrJwtRoles>[1]) => {
    await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN','MANAGER','VIEWER']);
  };
  app.get('/assembly/hermes-search-trial/scope', {preHandler}, async (_request,reply) => {
    try { return await service.scope(); }
    catch { return reply.code(503).send({code:'HERMES_SEARCH_UNAVAILABLE',message:'JEV記録検索を利用できません。'}); }
  });
  app.post('/assembly/hermes-search-trial/answer', {preHandler,config:{rateLimit:{max:12,timeWindow:'1 minute'}}}, async (request,reply) => {
    const {question, sessionId} = z.object({
      question: z.string().trim().min(1).max(4000),
      sessionId: z.string().uuid().optional()
    }).strict().parse(request.body);
    if (!service.isEnabled()) return reply.code(503).send({code:'HERMES_SEARCH_DISABLED',message:'JEV記録検索は無効です。'});
    try { return await service.answer(question, sessionId); }
    catch (error) {
      const diagnostic = safeWorkerFailureDiagnostic(error);
      if (diagnostic) {
        const requestId = /^[A-Za-z0-9_-]{1,64}$/u.test(request.id) ? request.id : undefined;
        app.log.warn({ requestId, ...diagnostic }, 'Hermes search worker request failed');
      }
      return reply.code(503).send({code:'HERMES_SEARCH_UNAVAILABLE',message:error instanceof Error?error.message:'検索に失敗しました。'});
    }
  });
  app.addHook('onClose',async()=>service.close());
}
