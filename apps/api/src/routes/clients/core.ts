import type { FastifyInstance } from 'fastify';

import {
  getClientStatusesWithLatestLogs,
  listClientDevices,
  listClientLogs,
  storeClientLogs,
  updateClientDevice,
  upsertClientHeartbeat,
  upsertClientStatus
} from '../../services/clients/client-telemetry.service.js';
import {
  canManage,
  canViewStatus,
  heartbeatSchema,
  logListQuerySchema,
  logsPayloadSchema,
  metricSchema,
  requireClientKey,
  updateClientSchema
} from './shared.js';

export async function registerClientCoreRoutes(app: FastifyInstance): Promise<void> {
  app.post('/clients/heartbeat', async (request) => {
    const body = heartbeatSchema.parse(request.body);
    const client = await upsertClientHeartbeat(body);
    return { client };
  });

  app.get('/clients', { preHandler: canManage }, async () => {
    const clients = await listClientDevices();
    return { clients };
  });

  app.put('/clients/:id', { preHandler: canManage }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateClientSchema.parse(request.body);
    const client = await updateClientDevice({
      id,
      name: body.name,
      defaultMode: body.defaultMode ?? undefined
    });
    return { client };
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
      limit: query.limit,
      since: query.since
    });
  });
}
