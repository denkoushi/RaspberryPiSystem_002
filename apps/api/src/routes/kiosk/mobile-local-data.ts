import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { z } from 'zod';

import { getMobileDataSnapshot, getMobileDataVersions } from '../../services/mobile-placement/mobile-local-data.service.js';

import type { KioskRouteDeps } from './production-schedule/shared.js';
import type { FastifyInstance } from 'fastify';

const unzip = promisify(gunzip);

export async function registerMobileLocalDataRoutes(app: FastifyInstance, deps: Pick<KioskRouteDeps, 'requireClientDevice'>) {
  app.get('/kiosk/mobile-local-data/versions', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    reply.header('Cache-Control', 'private, no-store');
    return getMobileDataVersions();
  });
  app.get('/kiosk/mobile-local-data/:dataset', { config: { rateLimit: { max: 30, timeWindow: '1 minute' }, compress: false } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const { dataset } = z.object({ dataset: z.enum(['purchase', 'schedule', 'placements']) }).parse(request.params);
    const { version } = z.object({ version: z.string().optional() }).parse(request.query);
    const current = (await getMobileDataVersions())[dataset];
    reply.header('Cache-Control', 'private, no-store').header('Vary', 'Accept-Encoding');
    if (version === current.version) return reply.code(304).send();
    const snapshot = await getMobileDataSnapshot(dataset, current);
    request.log.info({ dataset, version: snapshot.version, rows: snapshot.rowCount,
      jsonBytes: snapshot.jsonBytes, gzipBytes: snapshot.gzip.length, buildMs: snapshot.buildMs }, 'Mobile local data snapshot');
    reply.type('application/json');
    const acceptsGzip = (request.headers['accept-encoding'] ?? '').split(',').some((value) => {
      const [encoding, ...parameters] = value.trim().split(';');
      const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
      return encoding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0);
    });
    if (acceptsGzip) {
      return reply.header('Content-Encoding', 'gzip').send(snapshot.gzip);
    }
    return reply.send(await unzip(snapshot.gzip));
  });
}
