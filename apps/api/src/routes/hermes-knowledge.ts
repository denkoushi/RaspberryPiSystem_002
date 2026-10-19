import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { findClientDeviceByApiKey, parseKioskApiClientKeyHeader } from '../services/clients/client-device-auth.service.js';
import { getKnowledgeRuntime } from '../services/knowledge/knowledge-runtime.js';
import type { Intake } from '../services/knowledge/knowledge-intake.port.js';
import { triagePendingSchema } from '../services/knowledge/knowledge-triage.service.js';
import { intakeResponse } from '../services/knowledge/knowledge-intake.service.js';
import { approveRequestSchema, errorReportRequestSchema, positionRanksRequestSchema, returnRequestSchema, reviewRequestSchema } from '../services/knowledge/procedure-review-input.js';
import { procedureImageIds } from '../services/knowledge/procedure-content.js';

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
  const withTriage = async (rows: Intake[]) => {
    const triages = new Map((await runtime.triage.get(rows.map(row => row.id))).map(triage => [triage.intakeId, triage]));
    return rows.map(row => intakeResponse(row, triages.get(row.id)));
  };
  const posterError = (error: unknown) => {
    if (error instanceof Error && error.message === 'UNKNOWN_POSTER') throw new ApiError(400, '社員タグを確認できません。もう一度かざしてください。');
    throw error;
  };

  app.post('/hermes-knowledge/intakes', { bodyLimit: 56_000_000,
    onRequest: async (request, reply) => { await knowledgeActor(request, reply); },
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const owner = await knowledgeActor(request, reply);
    try {
      const response = await runtime.intake.receive(owner, request.body);
      runtime.worker.kick();
      const [triage] = await runtime.triage.get([response.id]);
      return triage ? { ...response, triage: { state: triage.state, suggestions: triage.suggestions, decidedProcedureId: triage.decidedProcedureId } } : response;
    } catch (error) {
      if (error instanceof Error && error.message === 'UNKNOWN_POSTER') throw new ApiError(400, '社員タグを確認できません。もう一度かざしてください。');
      if (error instanceof Error && error.message === 'INTAKE_CONFLICT') throw new ApiError(409, '送信IDが別の内容に使用されています。');
      if (error instanceof Error && error.message === 'UNKNOWN_PROCEDURE_TOPIC') throw new ApiError(404, '案件が見つかりません。');
      if (error instanceof Error && error.message === 'UNKNOWN_KNOWLEDGE_FIELD') throw new ApiError(400, '分野を選んでください。');
      if (error instanceof Error && error.message === 'INVALID_ATTACHMENT') throw new ApiError(400, '添付の形式・サイズを確認してください。画像は10 MB、PDFは20 MBまでです。');
      throw error;
    }
  });
  app.get('/hermes-knowledge/intakes', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const owner = await knowledgeActor(request, reply);
    const { conversationId } = z.object({ conversationId: z.string().uuid() }).parse(request.query);
    return { intakes: await withTriage(await runtime.repository.history(owner, conversationId)) };
  });
  app.post('/hermes-knowledge/intakes/:id/retry', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const owner = await knowledgeActor(request, reply);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    if (!await runtime.repository.retry(id, owner, version)) throw new ApiError(409, '再処理できる状態ではありません。最新の状態を確認してください。');
    runtime.worker.kick(); return (await withTriage([(await runtime.repository.get(id, owner))!]))[0];
  });
  app.post('/hermes-knowledge/intakes/:id/choice', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const owner = await knowledgeActor(request, reply);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { version, action } = z.object({ version: z.number().int().positive(), action: z.enum(['save', 'ask', 'report', 'delegate']) }).strict().parse(request.body);
    if (!await runtime.repository.choose(id, owner, version, action)) throw new ApiError(409, 'この確認は古くなっています。最新の入力からやり直してください。');
    runtime.worker.kick(); return (await withTriage([(await runtime.repository.get(id, owner))!]))[0];
  });
  app.post('/hermes-knowledge/triage/pending', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    return runtime.triageService.pending(request.body).catch(posterError);
  });
  app.post('/hermes-knowledge/triage/:intakeId/decide', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { intakeId } = z.object({ intakeId: z.string().uuid() }).parse(request.params);
    try {
      const decided = await runtime.triageService.decide(intakeId, request.body);
      runtime.procedureWorker.kick(); return decided;
    } catch (error) {
      if (error instanceof Error && error.message === 'TRIAGE_NOT_YOURS') throw new ApiError(403, '自分の投稿だけ仕分けできます。');
      if (error instanceof Error && error.message === 'TRIAGE_ALREADY_DECIDED') throw new ApiError(409, 'この投稿は仕分け済みです。');
      if (error instanceof Error && error.message === 'UNKNOWN_PROCEDURE_TOPIC') throw new ApiError(404, '案件が見つかりません。');
      if (error instanceof Error && error.message === 'UNKNOWN_KNOWLEDGE_FIELD') throw new ApiError(400, '分野を選んでください。');
      return posterError(error);
    }
  });
  app.get('/hermes-knowledge/procedure-topics', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { q, target } = z.object({ q: z.string().max(80).default(''), target: z.string().min(1).max(80).optional() }).parse(request.query);
    const topics = target === undefined ? await runtime.procedures.searchTopics(q, 30) : await runtime.procedures.searchTopics(q, 30, target);
    return { topics: topics.map(({ procedureId, header, parts }) => ({ procedureId, title: header.title, parts, identifiers: header.identifiers })) };
  });
  app.get('/hermes-knowledge/fields', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    return { fields: await runtime.fields() };
  });
  app.get('/hermes-knowledge/subjects', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { q } = z.object({ q: z.string().max(80).default('') }).parse(request.query);
    return { subjects: await runtime.subjects.search(q) };
  });
  app.post('/hermes-knowledge/subjects/recent', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { posterTagUid } = triagePendingSchema.parse(request.body);
    const poster = await runtime.resolvePoster(posterTagUid);
    if (!poster) throw new ApiError(400, '社員タグを確認できません。もう一度かざしてください。');
    return { subjects: await runtime.subjects.recent(poster.id) };
  });
  app.get('/hermes-knowledge/work-types', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    return { workTypes: await runtime.workTypes() };
  });
  app.get('/hermes-knowledge/sources/:sourceId/images/:imageId', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { sourceId, imageId } = z.object({ sourceId: z.string().uuid(), imageId: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.params);
    const allowed = (await runtime.repository.readySources()).some(record => record.source.id === sourceId && record.source.images.some(image => image.id === imageId));
    if (!allowed) throw new ApiError(404, '画像が見つかりません。');
    return reply.header('Cache-Control', 'private, no-store').type('image/jpeg').send(await runtime.assets.readDisplay(imageId));
  });
  const reviewError = (error: unknown): never => {
    const code = error instanceof Error ? error.message : '';
    if (code === 'KNOWLEDGE_UNKNOWN_EMPLOYEE') throw new ApiError(400, '社員タグを確認してください。', undefined, code);
    if (code === 'KNOWLEDGE_DUPLICATE_TAG') throw new ApiError(409, '社員と計測機器のタグが重複しています。', undefined, code);
    if (code === 'KNOWLEDGE_INACTIVE_EMPLOYEE') throw new ApiError(403, '在籍中の社員のみ操作できます。', undefined, code);
    if (code === 'KNOWLEDGE_APPROVAL_FORBIDDEN') throw new ApiError(403, '班長相当以上の職位が必要です。', undefined, code);
    if (code === 'PROCEDURE_REVIEW_CONFLICT') throw new ApiError(409, '承認待ちの状態が変わりました。', undefined, code);
    if (code === 'PROCEDURE_REVISION_NOT_FOUND') throw new ApiError(404, '承認待ちの手順書が見つかりません。', undefined, code);
    if (code === 'PROCEDURE_NOT_PUBLISHED') throw new ApiError(409, '公開中の手順書がありません。', undefined, code);
    throw error;
  };
  const reviewBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const result = schema.safeParse(body);
    if (!result.success) throw new ApiError(400, '入力内容を確認してください。');
    return result.data;
  };
  const revisionParams = z.object({ revisionId: z.string().uuid() }).strict();

  app.post('/hermes-knowledge/reviews/pending', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { reviewerTagUid } = reviewBody(reviewRequestSchema, request.body);
    const reviewer = await runtime.reviewers.resolve(reviewerTagUid, true).catch(reviewError);
    return { reviewer: { displayName: reviewer.displayName, positionName: reviewer.positionName, rank: reviewer.rank },
      reviews: await runtime.procedures.listPendingApproval() };
  });
  app.post('/hermes-knowledge/reviews/:revisionId/detail', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { revisionId } = revisionParams.parse(request.params);
    const { reviewerTagUid } = reviewBody(reviewRequestSchema, request.body);
    await runtime.reviewers.resolve(reviewerTagUid, true).catch(reviewError);
    const procedure = await runtime.procedures.getForReview(revisionId);
    if (!procedure) throw new ApiError(404, '承認待ちの手順書が見つかりません。');
    return { procedure };
  });
  app.post('/hermes-knowledge/reviews/:revisionId/approve', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const actor = await knowledgeActor(request, reply);
    const { revisionId } = revisionParams.parse(request.params);
    const { reviewerTagUid, comment } = reviewBody(approveRequestSchema, request.body);
    const reviewer = await runtime.reviewers.resolve(reviewerTagUid, true).catch(reviewError);
    await runtime.procedures.approve(revisionId, reviewer, actor, comment).catch(reviewError);
    return { ok: true };
  });
  app.post('/hermes-knowledge/reviews/:revisionId/return', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const actor = await knowledgeActor(request, reply);
    const { revisionId } = revisionParams.parse(request.params);
    const { reviewerTagUid, comment } = reviewBody(returnRequestSchema, request.body);
    const reviewer = await runtime.reviewers.resolve(reviewerTagUid, true).catch(reviewError);
    await runtime.procedures.returnRevision(revisionId, reviewer, actor, comment).catch(reviewError);
    return { ok: true };
  });
  app.get('/hermes-knowledge/reviews/:revisionId/images/:imageId', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { revisionId, imageId } = revisionParams.extend({ imageId: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(request.params);
    const procedure = await runtime.procedures.getForReview(revisionId);
    if (!procedure || !procedureImageIds(procedure).has(imageId)) throw new ApiError(404, '画像が見つかりません。');
    return reply.header('Cache-Control', 'private, no-store').type('image/jpeg').send(await runtime.assets.readDisplay(imageId));
  });
  app.post('/hermes-knowledge/procedures/:procedureId/error-report', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const actor = await knowledgeActor(request, reply);
    const { procedureId } = z.object({ procedureId: z.string().uuid() }).strict().parse(request.params);
    const { reporterTagUid, comment } = reviewBody(errorReportRequestSchema, request.body);
    const reporter = await runtime.reviewers.resolve(reporterTagUid).catch(reviewError);
    await runtime.procedures.reportError(procedureId, reporter, actor, comment).catch(reviewError);
    return { ok: true };
  });
  app.get('/hermes-knowledge/position-ranks', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    await authorizeRoles('ADMIN', 'MANAGER')(request, reply);
    return runtime.reviewers.listRanks();
  });
  app.put('/hermes-knowledge/position-ranks', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    await authorizeRoles('ADMIN', 'MANAGER')(request, reply);
    const { ranks } = reviewBody(positionRanksRequestSchema, request.body);
    await runtime.reviewers.replaceRanks(ranks);
    return { ok: true };
  });

  app.get('/hermes-knowledge/procedures', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    return { procedures: await runtime.procedures.listPublished() };
  });
  app.get('/hermes-knowledge/procedures/:procedureId', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { procedureId } = z.object({ procedureId: z.string().uuid() }).parse(request.params);
    const procedure = await runtime.procedures.getPublished(procedureId);
    if (!procedure) throw new ApiError(404, '公開済みの手順書が見つかりません。');
    return { procedure };
  });
  app.get('/hermes-knowledge/procedures/:procedureId/images/:imageId', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    await knowledgeActor(request, reply);
    const { procedureId, imageId } = z.object({ procedureId: z.string().uuid(), imageId: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.params);
    // Only photos referenced by the published revision are readable through this route.
    const procedure = await runtime.procedures.getPublished(procedureId);
    if (!procedure || !procedureImageIds(procedure).has(imageId)) throw new ApiError(404, '画像が見つかりません。');
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
