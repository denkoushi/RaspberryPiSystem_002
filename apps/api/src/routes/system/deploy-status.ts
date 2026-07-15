import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveStatusClientIdFromRawKey } from '../../services/clients/client-device-auth.service.js';

function deployStatusFilePath(): string {
  return process.env.DEPLOY_STATUS_FILE_PATH ?? '/app/config/deploy-status.json';
}

const DEPLOY_STATUS_HELPER_TIMEOUT_MS = 15_000;
const DEPLOY_STATUS_HELPER_OUTPUT_LIMIT = 64 * 1024;

function deployStatusStateHelperPath(): string {
  if (process.env.DEPLOY_STATUS_STATE_HELPER_PATH) {
    return process.env.DEPLOY_STATUS_STATE_HELPER_PATH;
  }
  const candidates = [
    '/app/scripts/deploy/deploy-status-state.py',
    resolve(process.cwd(), 'scripts/deploy/deploy-status-state.py'),
    resolve(process.cwd(), '../../scripts/deploy/deploy-status-state.py')
  ];
  const helper = candidates.find((candidate) => existsSync(candidate));
  if (!helper) throw new Error('DEPLOY_STATUS_HELPER_NOT_FOUND');
  return helper;
}

function deployStatusPythonPath(): string {
  if (process.env.DEPLOY_STATUS_PYTHON_PATH) return process.env.DEPLOY_STATUS_PYTHON_PATH;
  return existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3';
}

function runDeployStatusState(arguments_: string[]): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let stdout = '';
    let stderrLength = 0;
    const child = spawn(
      deployStatusPythonPath(),
      [deployStatusStateHelperPath(), '--file', deployStatusFilePath(), ...arguments_],
      { shell: false, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const reject = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error('DEPLOY_STATUS_HELPER_FAILED'));
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject();
    }, DEPLOY_STATUS_HELPER_TIMEOUT_MS);

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > DEPLOY_STATUS_HELPER_OUTPUT_LIMIT) {
        child.kill('SIGKILL');
        reject();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrLength += chunk.length;
      if (stderrLength > DEPLOY_STATUS_HELPER_OUTPUT_LIMIT) {
        child.kill('SIGKILL');
        reject();
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        reject();
        return;
      }
      try {
        const result = JSON.parse(stdout.trim()) as unknown;
        settled = true;
        clearTimeout(timer);
        resolvePromise(result);
      } catch {
        reject();
      }
    });
  });
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

async function writeAcknowledgement(
  runId: string,
  statusClientId: string,
  phase: DeployAcknowledgementPhase
): Promise<DeployAcknowledgementResult> {
  const result = await runDeployStatusState([
    'ack', '--run-id', runId, '--client', statusClientId, '--phase', phase
  ]);
  if (!result || typeof result !== 'object') throw new Error('DEPLOY_STATUS_HELPER_FAILED');
  const acknowledgement = result as Record<string, unknown>;
  if (
    acknowledgement.acknowledged !== true
    || acknowledgement.runId !== runId
    || acknowledgement.phase !== phase
    || (acknowledgement.scheduledAt !== undefined && typeof acknowledgement.scheduledAt !== 'string')
  ) {
    throw new Error('DEPLOY_STATUS_HELPER_FAILED');
  }
  return typeof acknowledgement.scheduledAt === 'string'
    ? { scheduledAt: acknowledgement.scheduledAt }
    : {};
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
