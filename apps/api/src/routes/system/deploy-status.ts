import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { normalizeClientKey } from '../../lib/client-key.js';
import { prisma } from '../../lib/prisma.js';

const DEPLOY_STATUS_FILE =
  process.env.DEPLOY_STATUS_FILE_PATH ?? '/app/config/deploy-status.json';

/** Raw JSON from deploy-status.json (version 2) */
interface DeployStatusRawV2 {
  version?: number;
  kioskByClient?: Record<string, { maintenance?: boolean; startedAt?: string; runId?: string }>;
}

/** Normalized response for API */
export interface DeployStatusResponse {
  isMaintenance: boolean;
}

/**
 * Resolve statusClientId from x-client-key for deploy-status lookup.
 * Returns null if key is missing/invalid (caller treats as isMaintenance: false).
 */
async function resolveStatusClientId(rawClientKey: unknown): Promise<string | null> {
  const clientKey = normalizeClientKey(rawClientKey);
  if (!clientKey) return null;

  const clientDevice = await prisma.clientDevice.findUnique({
    where: { apiKey: clientKey },
    select: { statusClientId: true }
  });
  if (!clientDevice) return null;

  return clientDevice.statusClientId ?? null;
}

/**
 * Read and parse deploy-status.json. Separates I/O from normalization for testability.
 */
async function readDeployStatusFile(): Promise<DeployStatusRawV2 | null> {
  if (process.env.FORCE_KIOSK_MAINTENANCE === 'true') {
    return {
      version: 2,
      kioskByClient: { 'raspberrypi4-kiosk1': { maintenance: true, startedAt: new Date().toISOString() } }
    };
  }

  try {
    const content = await readFile(DEPLOY_STATUS_FILE, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as DeployStatusRawV2;
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

/**
 * Resolve isMaintenance for a given statusClientId from raw status.
 */
function resolveIsMaintenance(raw: DeployStatusRawV2 | null, statusClientId: string | null): boolean {
  if (!statusClientId || !raw?.kioskByClient) return false;

  const entry = raw.kioskByClient[statusClientId];
  return entry?.maintenance === true;
}

export function registerDeployStatusRoute(app: FastifyInstance): void {
  app.get('/system/deploy-status', async (request, reply) => {
    const rawClientKey = request.headers['x-client-key'];
    const statusClientId = await resolveStatusClientId(rawClientKey);
    const raw = await readDeployStatusFile();
    const isMaintenance = resolveIsMaintenance(raw, statusClientId);

    return reply.send({ isMaintenance } satisfies DeployStatusResponse);
  });
}
