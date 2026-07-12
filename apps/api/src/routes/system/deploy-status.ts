import type { FastifyInstance } from 'fastify';
import { chown, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveStatusClientIdFromRawKey } from '../../services/clients/client-device-auth.service.js';

const DEPLOY_STATUS_FILE =
  process.env.DEPLOY_STATUS_FILE_PATH ?? '/app/config/deploy-status.json';
const DEPLOY_STATUS_LOCK_DIRECTORY = `${DEPLOY_STATUS_FILE}.lock.d`;

/** Raw JSON from deploy-status.json (version 2) */
interface DeployStatusRawV2 {
  version?: number;
  kioskByClient?: Record<string, { maintenance?: boolean; startedAt?: string; updatedAt?: string; runId?: string; phase?: string }>;
  acknowledgements?: Record<string, Record<string, { acknowledgedAt: string }>>;
}

/** Normalized response for API */
export interface DeployStatusResponse {
  isMaintenance: boolean;
  runId?: string;
  phase?: 'preparing' | 'deploying' | 'failed';
  startedAt?: string;
}

/**
 * Resolve statusClientId from x-client-key for deploy-status lookup.
 * Returns null if key is missing/invalid (caller treats as isMaintenance: false).
 */
async function resolveStatusClientId(rawClientKey: unknown): Promise<string | null> {
  return resolveStatusClientIdFromRawKey(rawClientKey);
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
export function normalizeDeployStatusResponse(raw: DeployStatusRawV2 | null, statusClientId: string | null): DeployStatusResponse {
  if (!statusClientId || !raw?.kioskByClient) return { isMaintenance: false };
  const entry = raw.kioskByClient[statusClientId];
  if (entry?.maintenance !== true) return { isMaintenance: false };
  const phase = ['preparing', 'deploying', 'failed'].includes(entry.phase ?? '')
    ? (entry.phase as DeployStatusResponse['phase'])
    : undefined;
  return { isMaintenance: true, ...(entry.runId ? { runId: entry.runId } : {}), ...(phase ? { phase } : {}), ...(entry.startedAt ? { startedAt: entry.startedAt } : {}) };
}

async function withDeployStatusLock<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 10_000;
  let acquired = false;
  while (!acquired) {
    try {
      await mkdir(DEPLOY_STATUS_LOCK_DIRECTORY);
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await operation();
  } finally {
    await rm(DEPLOY_STATUS_LOCK_DIRECTORY, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function writeAcknowledgement(runId: string, statusClientId: string): Promise<void> {
  await withDeployStatusLock(async () => {
    const raw = await readDeployStatusFile();
    if (!raw) throw new Error('DEPLOY_ACK_RUN_MISMATCH');
  const entry = raw.kioskByClient?.[statusClientId];
  if (!entry || entry.maintenance !== true || entry.runId !== runId) throw new Error('DEPLOY_ACK_RUN_MISMATCH');
  raw.version = 2;
  raw.acknowledgements ??= {};
  raw.acknowledgements[runId] ??= {};
  raw.acknowledgements[runId][statusClientId] = { acknowledgedAt: new Date().toISOString() };
  await mkdir(dirname(DEPLOY_STATUS_FILE), { recursive: true });
  const temporary = `${DEPLOY_STATUS_FILE}.ack.${process.pid}.${Date.now()}`;
  const owner = await stat(DEPLOY_STATUS_FILE).catch(() => null);
  await writeFile(temporary, JSON.stringify(raw), 'utf-8');
  if (owner) await chown(temporary, owner.uid, owner.gid).catch(() => undefined);
  await rename(temporary, DEPLOY_STATUS_FILE);
  });
}

export function registerDeployStatusRoute(app: FastifyInstance): void {
  app.get('/system/deploy-status', async (request, reply) => {
    const rawClientKey = request.headers['x-client-key'];
    const statusClientId = await resolveStatusClientId(rawClientKey);
    const raw = await readDeployStatusFile();
    return reply.send(normalizeDeployStatusResponse(raw, statusClientId));
  });

  app.post('/system/deploy-status/ack', async (request, reply) => {
    const statusClientId = await resolveStatusClientId(request.headers['x-client-key']);
    if (!statusClientId) return reply.code(401).send({ code: 'CLIENT_KEY_INVALID' });
    const runId = typeof (request.body as { runId?: unknown } | null)?.runId === 'string'
      ? (request.body as { runId: string }).runId.trim()
      : '';
    if (!runId) return reply.code(400).send({ code: 'DEPLOY_ACK_RUN_ID_REQUIRED' });
    try {
      await writeAcknowledgement(runId, statusClientId);
      return reply.send({ acknowledged: true, runId });
    } catch {
      return reply.code(409).send({ code: 'DEPLOY_ACK_RUN_MISMATCH' });
    }
  });
}
