import type { FastifyInstance, FastifyRequest } from 'fastify';
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
const FULL_RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERIFICATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const MAX_STATUS_CLIENT_ID_LENGTH = 255;

const DEPLOY_STATUS_IDENTITY_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['authenticated', 'statusClientId'],
  properties: {
    authenticated: { type: 'boolean', const: true },
    statusClientId: { type: 'string', minLength: 1, maxLength: MAX_STATUS_CLIENT_ID_LENGTH }
  }
} as const;

const DEPLOY_STATUS_IDENTITY_ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: {
    code: { type: 'string', const: 'CLIENT_KEY_INVALID' }
  }
} as const;

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
    desiredReleaseSha?: string;
    verificationMode?: string;
    verificationId?: string;
  }>;
  acknowledgements?: Record<string, Record<string, {
    acknowledgedAt?: string;
    notice?: { acknowledgedAt: string };
    maintenance?: { acknowledgedAt: string };
    ready?: { acknowledgedAt: string; releaseSha: string };
  }>>;
}

/** Normalized response for API */
export interface DeployStatusResponse {
  isMaintenance: boolean;
  runId?: string;
  phase?: 'preparing' | 'deploying' | 'verifying' | 'failed';
  startedAt?: string;
  desiredReleaseSha?: string;
  verificationCycle?: 'release' | 'rollback';
  verificationId?: string;
  preNotice?: { scheduledAt?: string };
}

export interface DeployStatusIdentityResponse {
  authenticated: true;
  statusClientId: string;
}

type DeployAcknowledgementPhase = 'notice' | 'maintenance' | 'ready';

interface DeployAcknowledgementResult {
  scheduledAt?: string;
  releaseSha?: string;
  verificationId?: string;
}

/**
 * Resolve statusClientId from x-client-key for deploy-status lookup.
 * Returns null if key is missing/invalid (caller treats as isMaintenance: false).
 */
async function resolveStatusClientId(rawClientKey: unknown): Promise<string | null> {
  return resolveStatusClientIdFromRawKey(rawClientKey);
}

function hasOneClientKeyHeader(request: FastifyRequest): boolean {
  let headerCount = 0;
  const rawHeaders = request.raw.rawHeaders;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'x-client-key') headerCount += 1;
  }
  return headerCount === 1 && typeof request.headers['x-client-key'] === 'string';
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
}

function isValidStatusClientId(statusClientId: string | null): statusClientId is string {
  return typeof statusClientId === 'string'
    && statusClientId.length > 0
    && statusClientId.length <= MAX_STATUS_CLIENT_ID_LENGTH
    && statusClientId === statusClientId.trim()
    && !containsControlCharacter(statusClientId);
}

async function resolveDeployStatusIdentity(request: FastifyRequest): Promise<DeployStatusIdentityResponse | null> {
  if (!hasOneClientKeyHeader(request)) return null;
  try {
    const statusClientId = await resolveStatusClientId(request.headers['x-client-key']);
    if (!isValidStatusClientId(statusClientId)) return null;
    return { authenticated: true, statusClientId };
  } catch {
    // Authentication and binding failures are intentionally indistinguishable.
    return null;
  }
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
  const phase = ['preparing', 'deploying', 'verifying', 'failed'].includes(entry.phase ?? '')
    ? (entry.phase as DeployStatusResponse['phase'])
    : undefined;
  const desiredReleaseSha = phase === 'verifying'
    && typeof entry.desiredReleaseSha === 'string'
    && FULL_RELEASE_SHA_PATTERN.test(entry.desiredReleaseSha)
    ? entry.desiredReleaseSha
    : undefined;
  const verificationCycle = phase === 'verifying'
    && (entry.verificationMode === 'release' || entry.verificationMode === 'rollback')
    ? entry.verificationMode
    : undefined;
  const verificationId = phase === 'verifying'
    && typeof entry.verificationId === 'string'
    && VERIFICATION_ID_PATTERN.test(entry.verificationId)
    ? entry.verificationId
    : undefined;
  return {
    isMaintenance: true,
    ...(entry.runId ? { runId: entry.runId } : {}),
    ...(phase ? { phase } : {}),
    ...(entry.startedAt ? { startedAt: entry.startedAt } : {}),
    ...(desiredReleaseSha ? { desiredReleaseSha } : {}),
    ...(verificationCycle ? { verificationCycle } : {}),
    ...(verificationId ? { verificationId } : {})
  };
}

async function writeAcknowledgement(
  runId: string,
  statusClientId: string,
  phase: DeployAcknowledgementPhase,
  releaseSha?: string,
  verificationId?: string
): Promise<DeployAcknowledgementResult> {
  const arguments_ = ['ack', '--run-id', runId, '--client', statusClientId, '--phase', phase];
  if (phase === 'ready' && releaseSha && verificationId) {
    arguments_.push(
      '--release-sha', releaseSha,
      '--verification-id', verificationId
    );
  }
  const result = await runDeployStatusState(arguments_);
  if (!result || typeof result !== 'object') throw new Error('DEPLOY_STATUS_HELPER_FAILED');
  const acknowledgement = result as Record<string, unknown>;
  if (
    acknowledgement.acknowledged !== true
    || acknowledgement.runId !== runId
    || acknowledgement.phase !== phase
    || (acknowledgement.scheduledAt !== undefined && typeof acknowledgement.scheduledAt !== 'string')
    || (
      phase === 'ready'
      && (
        typeof releaseSha !== 'string'
        || typeof verificationId !== 'string'
        || acknowledgement.releaseSha !== releaseSha
        || acknowledgement.verificationId !== verificationId
        || !FULL_RELEASE_SHA_PATTERN.test(releaseSha)
        || !VERIFICATION_ID_PATTERN.test(verificationId)
      )
    )
  ) {
    throw new Error('DEPLOY_STATUS_HELPER_FAILED');
  }
  return {
    ...(typeof acknowledgement.scheduledAt === 'string'
      ? { scheduledAt: acknowledgement.scheduledAt }
      : {}),
    ...(phase === 'ready' ? { releaseSha, verificationId } : {})
  };
}

export function registerDeployStatusRoute(app: FastifyInstance): void {
  app.get('/system/deploy-status', async (request, reply) => {
    const rawClientKey = request.headers['x-client-key'];
    const statusClientId = await resolveStatusClientId(rawClientKey);
    const raw = await readDeployStatusFile();
    return reply.send(normalizeDeployStatusResponse(raw, statusClientId));
  });

  app.get(
    '/system/deploy-status/identity',
    {
      schema: {
        response: {
          200: DEPLOY_STATUS_IDENTITY_RESPONSE_SCHEMA,
          401: DEPLOY_STATUS_IDENTITY_ERROR_SCHEMA
        }
      }
    },
    async (request, reply) => {
      const identity = await resolveDeployStatusIdentity(request);
      if (!identity) return reply.code(401).send({ code: 'CLIENT_KEY_INVALID' });
      return reply.send(identity);
    }
  );

  app.post('/system/deploy-status/ack', async (request, reply) => {
    const statusClientId = await resolveStatusClientId(request.headers['x-client-key']);
    if (!statusClientId) return reply.code(401).send({ code: 'CLIENT_KEY_INVALID' });
    const body = request.body as {
      runId?: unknown;
      phase?: unknown;
      releaseSha?: unknown;
      verificationId?: unknown;
    } | null;
    const runId = typeof body?.runId === 'string'
      ? body.runId.trim()
      : '';
    if (!runId) return reply.code(400).send({ code: 'DEPLOY_ACK_RUN_ID_REQUIRED' });
    const requestedPhase = body?.phase;
    if (
      requestedPhase !== undefined
      && requestedPhase !== 'notice'
      && requestedPhase !== 'maintenance'
      && requestedPhase !== 'ready'
    ) {
      return reply.code(400).send({ code: 'DEPLOY_ACK_PHASE_INVALID' });
    }
    const phase: DeployAcknowledgementPhase = requestedPhase ?? 'maintenance';
    let releaseSha: string | undefined;
    let verificationId: string | undefined;
    if (phase === 'ready') {
      if (body?.releaseSha === undefined) {
        return reply.code(400).send({ code: 'DEPLOY_ACK_RELEASE_SHA_REQUIRED' });
      }
      if (typeof body.releaseSha !== 'string' || !FULL_RELEASE_SHA_PATTERN.test(body.releaseSha)) {
        return reply.code(400).send({ code: 'DEPLOY_ACK_RELEASE_SHA_INVALID' });
      }
      releaseSha = body.releaseSha;
      if (body.verificationId === undefined) {
        return reply.code(400).send({ code: 'DEPLOY_ACK_VERIFICATION_ID_REQUIRED' });
      }
      if (
        typeof body.verificationId !== 'string'
        || !VERIFICATION_ID_PATTERN.test(body.verificationId)
      ) {
        return reply.code(400).send({ code: 'DEPLOY_ACK_VERIFICATION_ID_INVALID' });
      }
      verificationId = body.verificationId;
    }
    try {
      const result = await writeAcknowledgement(
        runId,
        statusClientId,
        phase,
        releaseSha,
        verificationId
      );
      return reply.send({ acknowledged: true, runId, phase, ...result });
    } catch {
      return reply.code(409).send({ code: 'DEPLOY_ACK_RUN_MISMATCH' });
    }
  });
}
