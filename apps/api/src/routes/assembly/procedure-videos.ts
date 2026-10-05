import { enforceAssemblyProcedureEditLease, resolveAssemblyProcedureEditWriter } from './procedure-document-edit-leases.js';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { ProcedureVideoService } from '../../services/assembly/procedure-video.service.js';

const idParams = z.object({ id: z.string().uuid() });
const pageParams = idParams.extend({ pageIndex: z.coerce.number().int().min(0) });

export function registerProcedureVideoRoutes(app: FastifyInstance, options: {
  allowView: preHandlerHookHandler; allowWriteKiosk: preHandlerHookHandler; service?: ProcedureVideoService;
}) {
  const service = options.service ?? new ProcedureVideoService();
  const path = '/assembly/procedure-videos';
  app.post(`${path}/concat`, { preHandler: options.allowWriteKiosk }, async (request) => {
    const { sourceVideoIds, title } = z.object({ sourceVideoIds: z.array(z.string().uuid()).min(2).max(5), title: z.string().trim().max(200).optional() }).strict().parse(request.body);
    return service.requestConcat(sourceVideoIds, title);
  });
  app.get(path, { preHandler: options.allowView }, async (request) => ({ videos: await service.list(z.object({ state: z.enum(['active', 'discarded', 'all']).default('active'), q: z.string().trim().max(200).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query)) }));
  for (const type of ['file', 'poster'] as const) {
    app.get(`${path}/:id/${type}`, { preHandler: options.allowView, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
      const bytes = await service.readFile(idParams.parse(request.params).id, type === 'poster');
      reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').type(type === 'file' ? 'video/mp4' : 'image/jpeg');
      if (type === 'poster') return reply.send(bytes);
      reply.header('Accept-Ranges', 'bytes');
      const range = request.headers.range;
      if (!range) return reply.header('Content-Length', bytes.length).send(bytes);
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const invalid = () => reply.code(416).header('Content-Range', `bytes */${bytes.length}`).send();
      if (!match || (!match[1] && !match[2])) return invalid();
      const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length || (!match[1] && Number(match[2]) === 0)) return invalid();
      return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${bytes.length}`).header('Content-Length', end - start + 1).send(bytes.subarray(start, end + 1));
    });
  }
  for (const action of ['retry', 'discard', 'restore'] as const) {
    app.post(`${path}/:id/${action}`, { preHandler: options.allowWriteKiosk }, async (request) => {
      const { id } = idParams.parse(request.params);
      if (action === 'retry') await service.retry(id);
      else await service.setDiscarded(id, action === 'discard');
      return { saved: true };
    });
  }
  app.post(`${path}/:id/trim`, { preHandler: options.allowWriteKiosk }, async (request) => {
    const { startSeconds, endSeconds } = z.object({ startSeconds: z.number().finite().min(0), endSeconds: z.number().finite().min(0) }).strict().parse(request.body);
    await service.requestTrim(idParams.parse(request.params).id, startSeconds, endSeconds);
    return { saved: true };
  });
  app.get(`${path}/:id/comments`, { preHandler: options.allowView }, async (request) => ({ comments: await service.listComments(idParams.parse(request.params).id) }));
  app.put(`${path}/:id/comments`, { preHandler: options.allowWriteKiosk }, async (request) => {
    const { comments } = z.object({ comments: z.array(z.object({ atSeconds: z.number().finite().min(0), text: z.string().trim().min(1).max(80) }).strict()).max(5) }).strict().parse(request.body);
    return { comments: await service.replaceComments(idParams.parse(request.params).id, comments) };
  });
  const pagesPath = '/assembly/procedure-documents/:id/pages/:pageIndex/videos';
  app.get(pagesPath, { preHandler: options.allowView }, async (request) => {
    const { id, pageIndex } = pageParams.parse(request.params);
    return { videos: await service.listPage(id, pageIndex) };
  });
  app.put(pagesPath, { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] }, async (request) => {
    const { id, pageIndex } = pageParams.parse(request.params);
    const body = z.object({ videoIds: z.array(z.string().uuid()).max(50), accessPassword: z.string().max(128).default('') }).strict().parse(request.body);
    return { videos: await service.replacePage({ documentId: id, pageIndex, ...body, ...await resolveAssemblyProcedureEditWriter(request) }) };
  });
}
