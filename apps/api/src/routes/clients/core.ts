import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { FastifyInstance } from 'fastify';

import {
  getClientStatusesWithLatestLogs,
  listClientDevices,
  listClientLogs,
  registerClientDeviceAdmin,
  storeClientLogs,
  touchClientHeartbeat,
  updateClientDevice,
  upsertClientStatus
} from '../../services/clients/client-telemetry.service.js';
import {
  canManage,
  canViewStatus,
  clientHeartbeatBodySchema,
  logListQuerySchema,
  logsPayloadSchema,
  metricSchema,
  registerClientBodySchema,
  requireClientKey,
  updateClientSchema
} from './shared.js';

export async function registerClientCoreRoutes(app: FastifyInstance): Promise<void> {
  app.post('/clients', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    const body = registerClientBodySchema.parse(request.body);
    const client = await registerClientDeviceAdmin(body);
    return { client };
  });

  app.post('/clients/heartbeat', async (request) => {
    const clientKey = requireClientKey(request.headers['x-client-key']);
    clientHeartbeatBodySchema.parse(request.body ?? {});
    const client = await touchClientHeartbeat({
      clientKey,
    });
    return { client };
  });

  app.get('/clients', { preHandler: canManage }, async () => {
    const clients = await listClientDevices({ omitApiKey: true });
    return { clients };
  });

  app.get('/clients/:id/api-key', { preHandler: authorizeRoles('ADMIN') }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const client = await prisma.clientDevice.findUnique({ where: { id }, select: { apiKey: true } });
    if (!client) {
      throw new ApiError(404, 'クライアントデバイスが見つかりません');
    }
    return { apiKey: client.apiKey };
  });

  app.put('/clients/:id', { preHandler: canManage }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateClientSchema.parse(request.body);
    if (body.canProxyOtherDevices !== undefined && request.user?.role !== 'ADMIN') {
      const current = await prisma.clientDevice.findUnique({ where: { id }, select: { canProxyOtherDevices: true } });
      if (current && current.canProxyOtherDevices !== body.canProxyOtherDevices) {
        throw new ApiError(403, '管理者権限が必要です');
      }
    }
    const client = await updateClientDevice({
      id,
      statusClientId: body.statusClientId,
      name: body.name,
      location: body.location,
      defaultMode: body.defaultMode ?? undefined,
      kioskInitialRoute: body.kioskInitialRoute,
      haizenEdgeEnabled: body.haizenEdgeEnabled,
      shelfLayoutEditEnabled: body.shelfLayoutEditEnabled,
      procedureBoardEnabled: body.procedureBoardEnabled,
      planningBoardOfflineEnabled: body.planningBoardOfflineEnabled,
      siteKey: body.siteKey,
      isSignage: body.isSignage,
      signagePreviewTargetDeviceId: body.signagePreviewTargetDeviceId,
      canProxyOtherDevices: body.canProxyOtherDevices
    });
    const { apiKey, ...publicClient } = client;
    void apiKey;
    return { client: publicClient };
  });

  app.post('/clients/status', async (request) => {
    const clientKey = requireClientKey(request.headers['x-client-key']);
    const metrics = metricSchema.parse(request.body);
    return upsertClientStatus({
      clientKey,
      metrics,
      requestId: request.id
    });
  });

  app.post('/clients/logs', async (request) => {
    const clientKey = requireClientKey(request.headers['x-client-key']);
    const payload = logsPayloadSchema.parse(request.body);
    return storeClientLogs({
      clientKey,
      clientId: payload.clientId,
      logs: payload.logs,
      requestId: request.id
    });
  });

  app.get('/clients/status', { preHandler: canViewStatus }, async (request) => {
    return getClientStatusesWithLatestLogs(request.id);
  });

  app.get('/clients/logs', { preHandler: canViewStatus }, async (request) => {
    const query = logListQuerySchema.parse(request.query);
    return listClientLogs({
      requestId: request.id,
      clientId: query.clientId,
      level: query.level,
      category: query.category,
      limit: query.limit,
      since: query.since
    });
  });
}
