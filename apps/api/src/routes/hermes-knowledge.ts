import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { findClientDeviceByApiKey, parseKioskApiClientKeyHeader } from '../services/clients/client-device-auth.service.js';
import { getKnowledgeRuntime } from '../services/knowledge/knowledge-runtime.js';
import { intakeResponse } from '../services/knowledge/knowledge-intake.service.js';

export async function knowledgeActor(request: FastifyRequest, reply: FastifyReply): Promise<string> {
  if (request.headers.authorization) {
    await authorizeRoles('ADMIN', 'MANAGER', 'VIEWER')(request, reply);
    return `user:${request.user!.id}`;
  }
  const key = parseKioskApiClientKeyHeader(request.headers['x-client-key']);
  if (key) {
    const client = await findClientDeviceByApiKey(key);
    if (client) return `client:${client.id}`;
  }
  await authorizeRoles('ADMIN', 'MANAGER', 'VIEWER')(request, reply);
  return `user:${request.user!.id}`;
}

export function registerHermesKnowledgeRoutes(app: FastifyInstance) {
  const enabled = process.env.HERMES_KNOWLEDGE_ENABLED === 'true';
  app.get('/hermes-knowledge/capabilities', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    return { enabled, maxPdfPages: 20, maxPdfBytes: 20_000_000, maxImageBytes: 10_000_000 };
  });
  if (!enabled) return;
  const runtime = getKnowledgeRuntime();

  app.post('/hermes-knowledge/intakes', { bodyLimit: 56_000_000,
    onRequest: async (request, reply) => { await knowledgeActor(request, reply); },
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const owner = await knowledgeActor(request, reply);
    try {
      const response = await runtime.intake.receive(owner, request.body);
      runtime.worker.kick(); return response;
    } catch (error) {
      if (error instanceof Error && error.message === 'INTAKE_CONFLICT') throw new ApiError(409, '送信IDが別の内容に使用されています。');
      if (error instanceof Error && error.message === 'INVALID_ATTACHMENT') throw new ApiError(400, '添付の形式・サイズを確認してください。画像は10 MB、PDFは20 MBまでです。');
      throw error;
    }
  });
  app.get('/hermes-knowledge/intakes', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const owner = await knowledgeActor(request, reply);
    const { conversationId } = z.object({ conversationId: z.string().uuid() }).parse(request.query);
    return { intakes: (await runtime.repository.history(owner, conversationId)).map(intakeResponse) };
  });
  app.post('/hermes-knowledge/intakes/:id/retry', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const owner = await knowledgeActor(request, reply);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    if (!await runtime.repository.retry(id, owner, version)) throw new ApiError(409, '再処理できる状態ではありません。最新の状態を確認してください。');
    runtime.worker.kick(); return intakeResponse((await runtime.repository.get(id, owner))!);
  });
  app.post('/hermes-knowledge/intakes/:id/choice', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const owner = await knowledgeActor(request, reply);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { version, action } = z.object({ version: z.number().int().positive(), action: z.enum(['save', 'ask', 'report', 'delegate']) }).strict().parse(request.body);
    if (!await runtime.repository.choose(id, owner, version, action)) throw new ApiError(409, 'この確認は古くなっています。最新の入力からやり直してください。');
    runtime.worker.kick(); return intakeResponse((await runtime.repository.get(id, owner))!);
  });
  app.get('/hermes-knowledge/sources/:sourceId/images/:imageId', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { sourceId, imageId } = z.object({ sourceId: z.string().uuid(), imageId: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.params);
    const allowed = (await runtime.repository.readySources()).some(record => record.source.id === sourceId && record.source.images.some(image => image.id === imageId));
    if (!allowed) throw new ApiError(404, '画像が見つかりません。');
    return reply.header('Cache-Control', 'private, no-store').type('image/jpeg').send(await runtime.assets.readDisplay(imageId));
  });
  app.get('/hermes-knowledge/sources/:sourceId/pdf', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
    const source = (await runtime.repository.readySources()).find(record => record.source.id === sourceId)?.source;
    if (!source?.pdf) throw new ApiError(404, 'PDFが見つかりません。');
    return reply.header('Cache-Control', 'private, no-store').header('Content-Disposition', 'inline; filename="knowledge-source.pdf"').type('application/pdf').send(await runtime.assets.readOriginal(source.pdf.assetId));
  });
}
