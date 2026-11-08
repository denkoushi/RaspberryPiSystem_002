import type { FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from './auth.js';
import { findClientDeviceByApiKey } from '../services/clients/client-device-auth.service.js';

const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

export async function requireDeviceKeyOrViewer(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const headerKey = request.headers['x-client-key'];
  const apiKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  if (apiKey && await findClientDeviceByApiKey(apiKey)) return;
  await canView(request, reply);
}
