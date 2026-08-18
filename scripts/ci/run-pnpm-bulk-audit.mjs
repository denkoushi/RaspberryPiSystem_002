#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const AUDIT_PATH = '/-/npm/v1/security/advisories/bulk';
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const RETRY_DELAY_MS = 20_000;

function isGzip(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

export function decodeAuditResponse(buffer, contentEncoding = '') {
  return contentEncoding.toLowerCase().includes('gzip') || isGzip(buffer)
    ? gunzipSync(buffer)
    : buffer;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;

    request.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_REQUEST_BYTES) {
        reject(new Error('audit request exceeded the maximum size'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function forwardAuditRequest(body) {
  return new Promise((resolve, reject) => {
    const upstream = httpsRequest(
      {
        hostname: 'registry.npmjs.org',
        method: 'POST',
        path: AUDIT_PATH,
        headers: {
          accept: 'application/json',
          'accept-encoding': 'identity',
          'content-length': String(body.length),
          'content-type': 'application/json'
        },
        timeout: 30_000
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve({
              body: decodeAuditResponse(
                Buffer.concat(chunks),
                String(response.headers['content-encoding'] ?? '')
              ),
              contentType: String(response.headers['content-type'] ?? 'application/json'),
              statusCode: response.statusCode ?? 502
            });
          } catch (error) {
            reject(error);
          }
        });
        response.on('error', reject);
      }
    );
    upstream.on('timeout', () => upstream.destroy(new Error('npm audit endpoint timed out')));
    upstream.on('error', reject);
    upstream.end(body);
  });
}

async function handleProxyRequest(request, response) {
  if (request.method !== 'POST' || request.url !== AUDIT_PATH) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"unsupported audit proxy request"}');
    return;
  }

  try {
    const body = await readRequestBody(request);
    const parsed = JSON.parse(body.toString('utf8'));
    if (parsed == null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('audit request must be a JSON object');
    }
    const upstream = await forwardAuditRequest(body);
    response.writeHead(upstream.statusCode, {
      'content-length': String(upstream.body.length),
      'content-type': upstream.contentType
    });
    response.end(upstream.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `audit proxy failed: ${message}` }));
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function prepareAuditWorkspace(workspace, version) {
  const auditWorkspace = await mkdtemp(join(tmpdir(), 'raspisys-pnpm-audit-'));
  const manifest = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'));

  // pnpm 11 is used only as an advisory-protocol client because pnpm 9's audit
  // endpoint is retired.  Run it against an immutable copy of the resolved
  // lockfile, not against the pnpm 9 workspace whose exact engine contract it
  // must (correctly) reject.
  manifest.packageManager = `pnpm@${version}`;
  manifest.engines = { ...manifest.engines, pnpm: version };
  delete manifest.pnpm;
  await writeFile(
    join(auditWorkspace, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  await copyFile(join(workspace, 'pnpm-lock.yaml'), join(auditWorkspace, 'pnpm-lock.yaml'));
  await copyFile(
    join(workspace, 'pnpm-workspace.yaml'),
    join(auditWorkspace, 'pnpm-workspace.yaml')
  );
  return auditWorkspace;
}

function runPinnedPnpmAudit({ auditLevel, proxyRegistry, version, workspace }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        '--yes',
        `pnpm@${version}`,
        'with',
        version,
        '--dir',
        workspace,
        '--registry',
        proxyRegistry,
        'audit',
        `--audit-level=${auditLevel}`
      ],
      {
        cwd: tmpdir(),
        env: process.env,
        stdio: 'inherit'
      }
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`pnpm audit terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function runCriticalAudit(options) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const exitCode = await runPinnedPnpmAudit({ ...options, auditLevel: 'critical' });
    if (exitCode === 0) return;
    if (attempt === 3) {
      throw new Error('pnpm bulk audit (critical+) failed after retries');
    }
    process.stderr.write(`pnpm bulk audit (critical+) failed (attempt ${attempt}/3); retrying...\n`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

async function main() {
  const version = process.env.AUDIT_PNPM_VERSION ?? '11.4.0';
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const auditWorkspace = await prepareAuditWorkspace(workspace, version);
  const server = createServer((request, response) => {
    void handleProxyRequest(request, response);
  });

  await listen(server);
  const address = server.address();
  assert(address && typeof address === 'object');
  const proxyRegistry = `http://127.0.0.1:${address.port}/`;

  try {
    process.stdout.write('=== pnpm bulk audit: critical+ (required gate) ===\n');
    await runCriticalAudit({ proxyRegistry, version, workspace: auditWorkspace });

    process.stdout.write('=== pnpm bulk audit: high+ (informational; fix tracked separately) ===\n');
    const highExitCode = await runPinnedPnpmAudit({
      auditLevel: 'high',
      proxyRegistry,
      version,
      workspace: auditWorkspace
    });
    if (highExitCode !== 0) {
      process.stderr.write('::warning::pnpm bulk audit reported high severity issues; see log above\n');
    }
  } finally {
    await close(server);
    await rm(auditWorkspace, { recursive: true, force: true });
  }
}

function selfTest() {
  const payload = Buffer.from('{"ok":true}', 'utf8');
  assert.equal(decodeAuditResponse(payload).toString('utf8'), payload.toString('utf8'));
  assert.equal(
    decodeAuditResponse(gzipSync(payload), '').toString('utf8'),
    payload.toString('utf8')
  );
  assert.equal(
    decodeAuditResponse(gzipSync(payload), 'gzip').toString('utf8'),
    payload.toString('utf8')
  );
  process.stdout.write('pnpm bulk audit proxy self-test passed\n');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
