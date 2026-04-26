#!/usr/bin/env node
/**
 * DGX system-prod 用: host 上の llama-server を start/stop する最小 HTTP 制御サーバ。
 *
 * 環境変数:
 *   LLM_RUNTIME_CONTROL_TOKEN  必須
 *   LLM_RUNTIME_START_CMD      必須
 *   LLM_RUNTIME_STOP_CMD       必須
 *   LLM_RUNTIME_LISTEN_HOST    既定: 127.0.0.1
 *   LLM_RUNTIME_LISTEN_PORT    既定: 39090
 */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TOKEN = process.env.LLM_RUNTIME_CONTROL_TOKEN?.trim();
const START_CMD = process.env.LLM_RUNTIME_START_CMD?.trim();
const STOP_CMD = process.env.LLM_RUNTIME_STOP_CMD?.trim();
const HOST = process.env.LLM_RUNTIME_LISTEN_HOST?.trim() || '127.0.0.1';
const PORT = Number.parseInt(process.env.LLM_RUNTIME_LISTEN_PORT?.trim() || '39090', 10);

if (!TOKEN) {
  console.error('LLM_RUNTIME_CONTROL_TOKEN is required');
  process.exit(1);
}
if (!START_CMD) {
  console.error('LLM_RUNTIME_START_CMD is required');
  process.exit(1);
}
if (!STOP_CMD) {
  console.error('LLM_RUNTIME_STOP_CMD is required');
  process.exit(1);
}

function authOk(req) {
  const header = req.headers['x-runtime-control-token'];
  const value = Array.isArray(header) ? header[0] : header;
  return value === TOKEN;
}

async function runShell(command) {
  await execFileAsync('bash', ['-lc', command], {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

const server = http.createServer(async (req, res) => {
  if (!authOk(req)) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('unauthorized');
    return;
  }

  try {
    if (req.method === 'POST' && req.url === '/start') {
      await runShell(START_CMD);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, action: 'start' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/stop') {
      await runShell(STOP_CMD);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, action: 'stop' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok\n');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (error) {
    console.error('[dgx-llm-runtime-control]', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error instanceof Error ? error.message : 'error');
  }
});

server.listen(PORT, HOST, () => {
  console.error(`[dgx-llm-runtime-control] listening on http://${HOST}:${PORT}`);
});
