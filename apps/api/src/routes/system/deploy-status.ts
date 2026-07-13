import type { FastifyInstance } from 'fastify';
import { chown, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveStatusClientIdFromRawKey } from '../../services/clients/client-device-auth.service.js';

function deployStatusFilePath(): string {
  return process.env.DEPLOY_STATUS_FILE_PATH ?? '/app/config/deploy-status.json';
}

function deployStatusLockDirectory(): string {
  return `${deployStatusFilePath()}.lock.d`;
}

/** Raw JSON from deploy-status.json (version 2) */
interface DeployStatusRawV2 {
  version?: number;
  kioskByClient?: Record<string, {
    maintenance?: boolean;
    startedAt?: string;
    updatedAt?: string;
    runId?: string;
    phase?: string;
    noticeDurationSeconds?: number;
    scheduledAt?: string;
  }>;
  acknowledgements?: Record<string, Record<string, {
    acknowledgedAt?: string;
    notice?: { acknowledgedAt: string };
    maintenance?: { acknowledgedAt: string };
  }>>;
}

/** Normalized response for API */
export interface DeployStatusResponse {
  isMaintenance: boolean;
  runId?: string;
  phase?: 'preparing' | 'deploying' | 'failed';
  startedAt?: string;
  preNotice?: { scheduledAt?: string };
}

type DeployAcknowledgementPhase = 'notice' | 'maintenance';

interface DeployAcknowledgementResult {
  scheduledAt?: string;
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
    const content = await readFile(deployStatusFilePath(), 'utf-8');
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
  if (!entry) return { isMaintenance: false };
  if (entry.maintenance === false && entry.phase === 'notice') {
    return {
      isMaintenance: false,
      ...(entry.runId ? { runId: entry.runId } : {}),
      preNotice: { ...(typeof entry.scheduledAt === 'string' ? { scheduledAt: entry.scheduledAt } : {}) }
    };
  }
  if (entry.maintenance !== true) return { isMaintenance: false };
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
      await mkdir(deployStatusLockDirectory());
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await operation();
  } finally {
    await rm(deployStatusLockDirectory(), { recursive: true, force: true }).catch(() => undefined);
  }
}

function acknowledgementPhaseRecord(
  raw: DeployStatusRawV2,
  runId: string,
  statusClientId: string
): NonNullable<DeployStatusRawV2['acknowledgements']>[string][string] {
  raw.acknowledgements ??= {};
  raw.acknowledgements[runId] ??= {};
  const existing = raw.acknowledgements[runId][statusClientId] ?? {};
  // Keep a concurrent/legacy maintenance acknowledgement valid while adding
  // phase separation for new notices.
  if (typeof existing.acknowledgedAt === 'string' && !existing.maintenance) {
    existing.maintenance = { acknowledgedAt: existing.acknowledgedAt };
    delete existing.acknowledgedAt;
  }
  raw.acknowledgements[runId][statusClientId] = existing;
  return existing;
}

function noticeDeadline(
  entry: NonNullable<DeployStatusRawV2['kioskByClient']>[string],
  acknowledgedAt: string
): string {
  if (typeof entry.scheduledAt === 'string') return entry.scheduledAt;
  const duration = entry.noticeDurationSeconds;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0) {
    throw new Error('DEPLOY_ACK_RUN_MISMATCH');
  }
  const acknowledgedAtMilliseconds = Date.parse(acknowledgedAt);
  if (Number.isNaN(acknowledgedAtMilliseconds)) throw new Error('DEPLOY_ACK_RUN_MISMATCH');
  const scheduledAt = new Date(acknowledgedAtMilliseconds + duration * 1000).toISOString();
  entry.scheduledAt = scheduledAt;
  entry.updatedAt = new Date().toISOString();
  return scheduledAt;
}

async function writeAcknowledgement(
  runId: string,
  statusClientId: string,
  phase: DeployAcknowledgementPhase
): Promise<DeployAcknowledgementResult> {
  return withDeployStatusLock(async () => {
    const raw = await readDeployStatusFile();
    if (!raw) throw new Error('DEPLOY_ACK_RUN_MISMATCH');
    const entry = raw.kioskByClient?.[statusClientId];
    if (!entry || entry.runId !== runId) throw new Error('DEPLOY_ACK_RUN_MISMATCH');
    const isNotice = phase === 'notice';
    if (isNotice ? (entry.maintenance !== false || entry.phase !== 'notice') : entry.maintenance !== true) {
      throw new Error('DEPLOY_ACK_RUN_MISMATCH');
    }

    raw.version = 2;
    const acknowledgement = acknowledgementPhaseRecord(raw, runId, statusClientId);
    acknowledgement[phase] ??= { acknowledgedAt: new Date().toISOString() };
    const acknowledgedAt = acknowledgement[phase]?.acknowledgedAt;
    if (typeof acknowledgedAt !== 'string') throw new Error('DEPLOY_ACK_RUN_MISMATCH');
    const scheduledAt = isNotice ? noticeDeadline(entry, acknowledgedAt) : undefined;

    const deployStatusFile = deployStatusFilePath();
    await mkdir(dirname(deployStatusFile), { recursive: true });
    const temporary = `${deployStatusFile}.ack.${process.pid}.${Date.now()}`;
    const owner = await stat(deployStatusFile).catch(() => null);
    await writeFile(temporary, JSON.stringify(raw), 'utf-8');
    if (owner) await chown(temporary, owner.uid, owner.gid).catch(() => undefined);
    await rename(temporary, deployStatusFile);
    return { ...(scheduledAt ? { scheduledAt } : {}) };
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
    const requestedPhase = (request.body as { phase?: unknown } | null)?.phase;
    if (requestedPhase !== undefined && requestedPhase !== 'notice' && requestedPhase !== 'maintenance') {
      return reply.code(400).send({ code: 'DEPLOY_ACK_PHASE_INVALID' });
    }
    const phase: DeployAcknowledgementPhase = requestedPhase ?? 'maintenance';
    try {
      const result = await writeAcknowledgement(runId, statusClientId, phase);
      return reply.send({ acknowledged: true, runId, phase, ...result });
    } catch {
      return reply.code(409).send({ code: 'DEPLOY_ACK_RUN_MISMATCH' });
    }
  });
}
