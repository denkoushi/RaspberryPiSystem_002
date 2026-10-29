import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { z } from 'zod';

import { getMobileDataSnapshot, getMobileDataVersions, MobileDataVersionChangedError } from '../../services/mobile-placement/mobile-local-data.service.js';

import type { KioskRouteDeps } from './production-schedule/shared.js';
import type { FastifyInstance } from 'fastify';

const unzip = promisify(gunzip);

export async function registerMobileLocalDataRoutes(app: FastifyInstance, deps: Pick<KioskRouteDeps, 'requireClientDevice'>) {
  app.get('/kiosk/mobile-local-data/versions', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    reply.header('Cache-Control', 'private, no-store');
    const { format } = z.object({ format: z.enum(['2']).optional() }).parse(request.query);
    const { legacyPurchase, purchaseEnrichment, ...versions } = await getMobileDataVersions();
    return format === '2' ? { ...versions, purchaseEnrichment, paged: true } : { ...versions, purchase: legacyPurchase };
  });
  app.get('/kiosk/mobile-local-data/:dataset', { config: { rateLimit: { max: 30, timeWindow: '1 minute' }, compress: false } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const { dataset } = z.object({ dataset: z.enum(['purchase', 'schedule', 'placements', 'purchaseEnrichment']) }).parse(request.params);
    const { version, format, page, pageVersion } = z.object({ version: z.string().optional(), format: z.enum(['2']).optional(),
      page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().positive().optional(),
      pageVersion: z.string().optional() }).parse(request.query);
    if (page !== undefined && (format !== '2' || dataset === 'purchaseEnrichment')) return reply.code(400).send();
    const kind = dataset === 'purchase' && format !== '2' ? 'legacyPurchase' : dataset;
    const current = (await getMobileDataVersions())[kind];
    reply.header('Cache-Control', 'private, no-store').header('Vary', 'Accept-Encoding');
    if (page !== undefined && pageVersion !== undefined && pageVersion !== current.version) return reply.code(409).send(current);
    if (version === current.version) return reply.code(304).send();
    const snapshot = await getMobileDataSnapshot(kind, current).catch((error: unknown) => {
      if (page !== undefined && error instanceof MobileDataVersionChangedError) return null;
      throw error;
    });
    if (!snapshot || page !== undefined && snapshot.version !== current.version) return reply.code(409).send();
    const payload = page === undefined ? snapshot : snapshot.pages[page - 1];
    if (!payload) return reply.code(400).send();
    request.log.info({ dataset, version: snapshot.version, rows: snapshot.rowCount,
      ...(page !== undefined ? { page, pageCount: snapshot.pages.length, pageSize: snapshot.pageSize } : {}),
      jsonBytes: payload.jsonBytes, gzipBytes: payload.gzip.length, buildMs: snapshot.buildMs }, 'Mobile local data snapshot');
    reply.type('application/json');
    const acceptsGzip = (request.headers['accept-encoding'] ?? '').split(',').some((value) => {
      const [encoding, ...parameters] = value.trim().split(';');
      const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
      return encoding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0);
    });
    if (acceptsGzip) {
      return reply.header('Content-Encoding', 'gzip').send(payload.gzip);
    }
    return reply.send(await unzip(payload.gzip));
  });
}
