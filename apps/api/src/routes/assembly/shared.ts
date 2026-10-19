import type { FastifyRequest } from 'fastify';
import { requireClientDevice } from '../kiosk/shared.js';

export async function tryGetClientDevice(headers: FastifyRequest['headers']): Promise<{
  id: string;
  name: string;
} | null> {
  try {
    const { clientDevice } = await requireClientDevice(headers['x-client-key']);
    return { id: clientDevice.id, name: clientDevice.name };
  } catch {
    return null;
  }
}

export async function buildAssemblyTraceabilityActor(request: FastifyRequest) {
  const clientDevice = await tryGetClientDevice(request.headers);
  return {
    username: request.user?.username ?? null,
    clientDeviceId: clientDevice?.id ?? null,
    clientDeviceNameSnapshot: clientDevice?.name ?? null
  };
}
