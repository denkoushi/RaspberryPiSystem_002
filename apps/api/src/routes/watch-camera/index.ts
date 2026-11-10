import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { acceptWatchCameraFrame, listWatchCameraFrames, readWatchCameraFrame, watchCameraQuerySchema } from '../../services/watch-camera/watch-camera.service.js';
import { deleteSampleSession, labelSampleFrame, listSampleCameras, listSampleFrames, listSampleSessions, readSampleFrame, sampleFrameIdSchema, sampleFramesSchema, sampleIdSchema, sampleImageSchema, sampleLabelSchema, sampleListSchema, sampleStartSchema, startSampleSession, stopSampleSession } from '../../services/watch-camera/watch-camera-sample.service.js';
import { normalizeClientKey, requireClientDevice } from '../kiosk/shared.js';

export async function registerWatchCameraRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (cameraApp) => {
    cameraApp.addContentTypeParser('image/jpeg', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    cameraApp.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    const receiveLimits = [
      cameraApp.createRateLimit({ max: 12, timeWindow: '1 minute', keyGenerator: (request) => `watch-camera:ip:${request.ip}` }),
      cameraApp.createRateLimit({ max: 12, timeWindow: '1 minute',
        keyGenerator: (request) => `watch-camera:key:${normalizeClientKey(request.headers['x-client-key']) ?? 'none'}` }),
    ];
    cameraApp.post('/watch-camera/frames', {
      bodyLimit: 300 * 1024,
      onRequest: async (request, reply) => {
        for (const limit of receiveLimits) {
          const result = await limit(request);
          if (!result.isAllowed && result.isExceeded) {
            reply.header('Retry-After', result.ttlInSeconds);
            throw new ApiError(429, 'Too Many Requests');
          }
        }
      },
      config: { rateLimit: { max: 12, timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => `${request.ip}:${normalizeClientKey(request.headers['x-client-key']) ?? 'none'}` } },
    }, async (request, reply) => {
      const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
      if (!clientDevice.name.startsWith('zero-edge-cam-')) throw new ApiError(403, '監視カメラ端末ではありません');
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'image/jpeg'
        || !Buffer.isBuffer(request.body) || !request.body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
        throw new ApiError(400, 'JPEGの形式が正しくありません');
      }
      acceptWatchCameraFrame(clientDevice.id, request.body);
      return reply.code(202).send({ accepted: true });
    });
  });
  app.get('/watch-camera/admin/frames', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    return { frames: await listWatchCameraFrames(watchCameraQuerySchema.parse(request.query)) };
  });
  app.get('/watch-camera/admin/frames/:id/:variant', { preHandler: authorizeRoles('ADMIN') }, async (request, reply) => {
    const { id, variant } = z.object({ id: z.string().uuid(), variant: z.enum(['full', 'thumb']) }).parse(request.params);
    return reply.header('Cache-Control', variant === 'thumb' ? 'private, max-age=86400' : 'private').type('image/jpeg').send(await readWatchCameraFrame(id, variant));
  });
  app.get('/watch-camera/admin/cameras', { preHandler: authorizeRoles('ADMIN') }, async () => listSampleCameras());
  app.post('/watch-camera/admin/samples', { preHandler: authorizeRoles('ADMIN') }, async (request, reply) => {
    return reply.code(201).send(await startSampleSession(sampleStartSchema.parse(request.body)));
  });
  app.post('/watch-camera/admin/samples/:id/stop', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    return stopSampleSession(sampleIdSchema.parse(request.params).id);
  });
  app.get('/watch-camera/admin/samples', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    return listSampleSessions(sampleListSchema.parse(request.query).clientDeviceId);
  });
  app.get('/watch-camera/admin/samples/:id/frames', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    return listSampleFrames(sampleIdSchema.parse(request.params).id, sampleFramesSchema.parse(request.query));
  });
  app.get('/watch-camera/admin/sample-frames/:frameId/:variant', { preHandler: authorizeRoles('ADMIN') }, async (request, reply) => {
    const { frameId, variant } = sampleImageSchema.parse(request.params);
    return reply.header('Cache-Control', variant === 'thumb' ? 'private, max-age=86400' : 'private').type('image/jpeg').send(await readSampleFrame(frameId, variant));
  });
  app.patch('/watch-camera/admin/sample-frames/:frameId', { preHandler: authorizeRoles('ADMIN') }, async (request, reply) => {
    await labelSampleFrame(sampleFrameIdSchema.parse(request.params).frameId, sampleLabelSchema.parse(request.body).label);
    return reply.code(204).send();
  });
  app.delete('/watch-camera/admin/samples/:id', { preHandler: authorizeRoles('ADMIN') }, async (request, reply) => {
    await deleteSampleSession(sampleIdSchema.parse(request.params).id);
    return reply.code(204).send();
  });

}
